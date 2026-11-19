import { homedir } from 'node:os';
import { pathToFileURL } from 'node:url';
import type {
  ContentBlock,
  InitializeResponse,
  SessionConfigOption,
  SessionNotification,
} from '@agentclientprotocol/sdk';
import type { NormalizedEvent } from '../../normalize.js';
import type { Autonomy, SessionInteractionMode } from '../../protocol.js';
import type { ProviderMention } from '../catalog.js';
import type {
  ProviderModelSettings,
  ProviderChildSession,
  ProviderOpenInput,
  ProviderResumeInput,
  ProviderSession,
  ProviderProcess,
} from '../session.js';
import { MessageQueue } from '../claude/claudeMessages.js';
import { DevinClient } from './devinClient.js';
import { DevinEvents } from './devinEvents.js';
import { startDevinMcp } from './devinMcp.js';
import { devinPermission } from './devinPermissions.js';
import { devinChildId, DevinSubagents } from './devinSubagents.js';
import { DevinTerminals } from './devinTerminals.js';

const MODES: Record<Autonomy, string> = {
  off: 'accept-edits',
  low: 'accept-edits',
  medium: 'smart',
  high: 'bypass',
};
type SessionInput = ProviderOpenInput | ProviderResumeInput;

export class DevinSession implements ProviderSession {
  readonly provider = 'devin';
  private readonly client: DevinClient;
  private readonly terminals: DevinTerminals;
  private sessionId?: string;
  private mapper?: DevinEvents;
  private subagents?: DevinSubagents;
  private readonly backgroundListeners = new Set<(event: NormalizedEvent) => void>();
  private capabilities?: InitializeResponse['agentCapabilities'];
  private queue?: MessageQueue<NormalizedEvent>;
  private permissionAbort = new AbortController();
  private closing = false;
  private closePromise?: Promise<void>;
  private mcpRelease?: Promise<void>;
  private mcpStart?: ReturnType<typeof startDevinMcp>;
  readonly closed: Promise<Error | undefined>;
  private selectedAutonomy: Autonomy;
  private interactionMode: SessionInteractionMode;
  private changes: Promise<void> = Promise.resolve();
  configOptions: SessionConfigOption[] = [];

  constructor(
    executable: string,
    private readonly input: SessionInput,
  ) {
    this.selectedAutonomy = input.autonomy ?? 'low';
    this.interactionMode = input.interactionMode ?? 'auto';
    this.terminals = new DevinTerminals(
      input.cwd ?? homedir(),
      (sessionId) =>
        !this.isClosed && sessionId === this.sessionId && input.interactions.isActive(),
      (notification) => {
        this.update(notification);
      },
    );
    this.client = new DevinClient(executable, input.cwd ?? homedir(), {
      terminals: this.terminals,
      update: (notification) => {
        this.update(notification);
      },
      permission: (request) => {
        const childId = devinChildId(request.toolCall);
        let signal: AbortSignal | undefined;
        if (childId) signal = this.subagents?.permissionSignal(childId);
        else if (this.queue) signal = this.permissionAbort.signal;
        if (this.isClosed || !signal || request.sessionId !== this.sessionId)
          return Promise.resolve({ outcome: { outcome: 'cancelled' } });
        return devinPermission(
          input.appSessionId ?? this.providerSessionId,
          request,
          input.interactions,
          signal,
        );
      },
    });
    this.closed = this.client.closed.then(async (error) => {
      this.permissionAbort.abort();
      this.subagents?.close();
      this.backgroundListeners.clear();
      input.interactions.cancelPending();
      this.queue?.close(error);
      try {
        try {
          await this.terminals.close();
        } finally {
          await this.releaseMcp();
        }
      } catch (cleanupError) {
        return (
          error ?? (cleanupError instanceof Error ? cleanupError : new Error(String(cleanupError)))
        );
      }
      return error;
    });
  }

  get providerSessionId(): string {
    if (!this.sessionId) throw new Error('Devin session has not opened.');
    return this.sessionId;
  }
  get autonomy(): Autonomy {
    return this.selectedAutonomy;
  }
  get process() {
    return this.client.process;
  }
  onProcessRootsChanged(listener: (roots: readonly ProviderProcess[]) => void): () => void {
    return this.terminals.onProcessRootsChanged(listener);
  }
  get isClosed(): boolean {
    return this.closing || this.client.isClosed;
  }

  async open(resumeId?: string, signal?: AbortSignal): Promise<void> {
    const timeout = AbortSignal.timeout(30_000);
    const abort = signal ? AbortSignal.any([signal, timeout]) : timeout;
    const stop = () => {
      void this.close().catch(() => undefined);
    };
    abort.addEventListener('abort', stop, { once: true });
    try {
      abort.throwIfAborted();
      const initialized = await this.client.initialize();
      this.requireOpen();
      this.capabilities = initialized.agentCapabilities;
      this.mcpStart = startDevinMcp(this.input.mcpServers ?? [], this.input.inAppMcpServers ?? []);
      const mcpServers = await this.mcpStart;
      this.requireOpen();
      const cwd = this.input.cwd ?? homedir();
      if (resumeId) {
        if (!this.capabilities?.loadSession)
          throw new Error('Devin cannot load saved conversations.');
        this.sessionId = resumeId;
        this.subagents = new DevinSubagents(this.input.appSessionId ?? resumeId, resumeId);
        const loaded = await this.client.connection.agent.request('session/load', {
          sessionId: resumeId,
          cwd,
          mcpServers,
        });
        this.requireOpen();
        if (loaded.configOptions) this.configOptions = loaded.configOptions;
      } else {
        const created = await this.client.connection.agent.request('session/new', {
          cwd,
          mcpServers,
        });
        this.requireOpen();
        this.sessionId = created.sessionId;
        if (created.configOptions) this.configOptions = created.configOptions;
      }
      this.mapper = new DevinEvents(
        this.input.appSessionId ?? this.providerSessionId,
        this.providerSessionId,
      );
      this.subagents ??= new DevinSubagents(
        this.input.appSessionId ?? this.providerSessionId,
        this.providerSessionId,
      );
      await this.setInteractionMode(this.interactionMode);
      this.requireOpen();
      await this.setModel({ modelId: this.input.modelId });
      this.requireOpen();
    } catch (error) {
      const failure = await this.client.diagnostic(error);
      await this.close();
      throw failure;
    } finally {
      abort.removeEventListener('abort', stop);
    }
  }

  async *stream(
    prompt: string,
    mentions?: ProviderMention[],
  ): AsyncGenerator<NormalizedEvent, void, undefined> {
    this.requireOpen();
    if (this.queue) throw new Error('This Devin session is already running a turn.');
    this.terminals.startTurn();
    const queue = new MessageQueue<NormalizedEvent>();
    this.queue = queue;
    this.permissionAbort = new AbortController();
    const signal = this.permissionAbort.signal;
    const run = async () => {
      try {
        await this.changes;
        this.requireOpen();
        if (signal.aborted) {
          for (const event of this.mapper?.interrupt() ?? []) queue.push(event);
          queue.push({ done: true });
          queue.close();
          return;
        }
        const content: ContentBlock[] = [
          { type: 'text', text: prompt },
          ...(mentions ?? []).map((mention) =>
            mention.path
              ? {
                  type: 'resource_link' as const,
                  name: mention.name,
                  uri: pathToFileURL(mention.path).href,
                }
              : { type: 'text' as const, text: `@${mention.name}` },
          ),
        ];
        const response = await this.client.connection.agent.request('session/prompt', {
          sessionId: this.providerSessionId,
          prompt: content,
        });
        if (response.stopReason === 'refusal') throw new Error('Devin refused this request.');
        if (response.stopReason === 'cancelled')
          for (const event of this.mapper?.interrupt() ?? []) queue.push(event);
        queue.push({ done: true });
        queue.close();
      } catch (error) {
        queue.close(await this.client.diagnostic(error));
      }
    };
    const turn = { settled: false };
    const running = run().finally(() => {
      turn.settled = true;
    });
    try {
      yield* queue;
    } finally {
      if (!turn.settled && !this.isClosed) {
        await this.interrupt();
        await running;
      }
      this.permissionAbort.abort();
      if (this.queue === queue) this.queue = undefined;
    }
  }

  steer(): Promise<false> {
    return Promise.resolve(false);
  }

  onBackgroundEvent(listener: (event: NormalizedEvent) => void): () => void {
    if (!this.isClosed) {
      this.backgroundListeners.add(listener);
      for (const event of this.subagents?.takeReplayedChildren() ?? []) this.emitBackground(event);
    }
    return () => {
      this.backgroundListeners.delete(listener);
    };
  }

  restoreChildren(children: readonly ProviderChildSession[]): void {
    if (!this.isClosed) this.subagents?.restore(children);
  }

  setAutonomy(autonomy: Autonomy): Promise<void> {
    return this.change(async () => {
      await this.configure('mode', this.interactionMode === 'spec' ? 'plan' : MODES[autonomy]);
      this.selectedAutonomy = autonomy;
    });
  }

  setInteractionMode(mode: SessionInteractionMode): Promise<void> {
    return this.change(async () => {
      await this.configure('mode', mode === 'spec' ? 'plan' : MODES[this.selectedAutonomy]);
      this.interactionMode = mode;
    });
  }

  setModel(settings: ProviderModelSettings): Promise<void> {
    if (!settings.modelId) return Promise.resolve();
    const model = settings.modelId;
    return this.change(() => this.configure('model', model));
  }

  async interrupt(): Promise<void> {
    this.permissionAbort.abort();
    this.subagents?.cancelPermissions();
    this.input.interactions.cancelPending();
    const stopped = this.terminals.interrupt();
    try {
      if (!this.isClosed && this.queue)
        await this.client.connection.agent.notify('session/cancel', {
          sessionId: this.providerSessionId,
        });
    } finally {
      await stopped;
    }
  }

  async delete(): Promise<void> {
    if (this.sessionId && this.capabilities?.sessionCapabilities?.delete)
      await this.client.connection.agent.request(
        'session/delete',
        { sessionId: this.sessionId },
        {
          cancellationSignal: AbortSignal.timeout(1000),
          stopWaitingOnCancel: true,
        },
      );
  }

  close(): Promise<void> {
    if (this.closePromise) return this.closePromise;
    this.closing = true;
    this.permissionAbort.abort();
    this.subagents?.close();
    this.backgroundListeners.clear();
    this.input.interactions.cancelPending();
    this.closePromise = (async () => {
      try {
        await this.terminals.close();
        if (
          this.sessionId &&
          !this.client.isClosed &&
          this.capabilities?.sessionCapabilities?.close
        )
          await this.client.connection.agent.request(
            'session/close',
            { sessionId: this.sessionId },
            {
              cancellationSignal: AbortSignal.timeout(1000),
              stopWaitingOnCancel: true,
            },
          );
      } finally {
        await this.client.stop();
        await this.releaseMcp();
      }
    })();
    return this.closePromise;
  }

  private async configure(configId: string, value: string): Promise<void> {
    this.requireOpen();
    const result = await this.client.connection.agent.request('session/set_config_option', {
      sessionId: this.providerSessionId,
      configId,
      value,
    });
    this.requireOpen();
    this.configOptions = result.configOptions;
  }

  private change(apply: () => Promise<void>): Promise<void> {
    const changed = this.changes.then(apply);
    this.changes = changed.catch(() => undefined);
    return changed;
  }

  private update(notification: SessionNotification): void {
    if (this.isClosed || (this.sessionId && notification.sessionId !== this.sessionId)) return;
    if (notification.update.sessionUpdate === 'config_option_update')
      this.configOptions = notification.update.configOptions;
    if (!this.mapper) {
      this.subagents?.replay(notification);
      return;
    }
    notification = this.terminals.resolve(notification);
    const childEvents = this.subagents?.map(notification);
    if (childEvents) {
      for (const event of childEvents) this.emitBackground(event);
      return;
    }
    if (!this.queue) return;
    for (const event of this.mapper.map(notification)) this.queue.push(event);
  }

  private emitBackground(event: NormalizedEvent): void {
    if (this.isClosed || !this.input.interactions.isActive()) return;
    for (const listener of this.backgroundListeners) listener(event);
  }

  private requireOpen(): void {
    if (this.isClosed) throw new Error('This Devin session is closed.');
  }

  private releaseMcp(): Promise<void> {
    this.mcpRelease ??= (async () => {
      try {
        await this.mcpStart;
      } finally {
        await Promise.all((this.input.inAppMcpServers ?? []).map((server) => server.close()));
      }
    })();
    return this.mcpRelease;
  }
}
