// One Claude Code process per DROIDEX session, driven through the agent SDK's
// streaming-input mode: the prompt is a live async iterable, so turns reuse the
// same process and the permission mode and model can change while it runs.
import {
  query,
  type McpServerConfig,
  type ModelInfo,
  type SDKMessage,
  type SDKUserMessage,
} from '@anthropic-ai/claude-agent-sdk';
import type { ChildProcess } from 'node:child_process';
import { randomUUID } from 'node:crypto';

import type { NormalizedEvent } from '../../normalize.js';
import type {
  Autonomy,
  ContextWindowTokens,
  ReasoningEffort,
  SessionInteractionMode,
  SessionPurpose,
} from '../../protocol.js';
import { errMsg } from '../../errors.js';
import type { SkillInfo } from '../catalog.js';
import type { ProviderInteractions } from '../interactions.js';
import type { ProviderModelSettings, ProviderSession } from '../session.js';
import { ClaudeCatalog } from './claudeCatalog.js';
import { claudeLaunchModel, planningModelNotice, type ClaudeDefaultModel } from './claudeModels.js';
import { ClaudeEventMapper, rateLimitRefusal } from './claudeEvents.js';
import {
  answersTurn,
  commandLifecycle,
  isSlashCommand,
  MessageQueue,
  turnFailure,
  type SteeringQuery,
} from './claudeMessages.js';
import { sessionOptions, claudeEffort } from './claudeOptions.js';
import { ClaudePermissionModes } from './claudePermissionModes.js';

export interface ClaudeSessionInput {
  // Claude pins the session id it is given, so DROIDEX's own identity is also
  // the provider's: there is no separate resume handle.
  appSessionId: string;
  executable: string;
  cwd: string;
  autonomy: Autonomy;
  interactionMode: SessionInteractionMode;
  sessionPurpose?: SessionPurpose;
  modelId?: string;
  reasoningEffort?: ReasoningEffort;
  fastMode?: boolean;
  contextWindowTokens?: ContextWindowTokens;
  // The provider's default model, so a switch back to it launches what the
  // CLI's own default would.
  defaultModel?: ClaudeDefaultModel;
  models: ModelInfo[];
  mcpServers: Record<string, McpServerConfig>;
  canvasScopeForRead?: () => string | undefined;
  interactions: ProviderInteractions;
  // Set when reopening a stored session instead of starting a new one.
  resume?: boolean;
}

export class ClaudeSession implements ProviderSession {
  readonly provider = 'claude' as const;
  readonly providerSessionId: string;
  readonly closed: Promise<Error | undefined>;

  private readonly abort = new AbortController();
  private resolveClosed: (error?: Error) => void = () => undefined;
  private failure?: Error;
  private readonly prompts = new MessageQueue<SDKUserMessage>();
  private readonly mapper: ClaudeEventMapper;
  private readonly query: SteeringQuery;
  // The permission capability probe must finish before the first prompt.
  // Control requests may only start after the CLI answers initialize.
  private readonly initialized: Promise<void>;
  private readonly catalog: ClaudeCatalog;
  // Resolves once the CLI process exists, which is all an open has to wait for.
  private readonly spawned: Promise<void>;
  private initializing = true;
  private child?: ChildProcess;
  private modelId: string | undefined;
  private fastMode: boolean;
  private readonly permissions: ClaudePermissionModes;
  private activeTurnId?: string;
  // The turn the user stopped, so only that turn's own error result is excused.
  private interruptedTurnId?: string;
  // The running turn takes steers: set once its prompt is pushed, never for a slash command.
  private steerable = false;
  // Steers the CLI has not started yet, by uuid, with whoever waits on each.
  private readonly steerDeliveries = new Map<string, (delivered: boolean) => void>();
  // The running turn's own result has arrived; it may still wait for steers.
  private turnAnswered = false;
  private turnQueue?: MessageQueue<{ message: SDKMessage; events: NormalizedEvent[] }>;
  private readonly backgroundListeners = new Set<(event: NormalizedEvent) => void>();

  constructor(private readonly input: ClaudeSessionInput) {
    this.providerSessionId = input.appSessionId;
    this.modelId = input.modelId;
    this.fastMode = input.fastMode ?? false;
    this.permissions = new ClaudePermissionModes(
      input.autonomy,
      input.interactionMode === 'spec',
      () => {
        this.requireOpen();
      },
    );
    this.mapper = new ClaudeEventMapper(input.appSessionId, input.modelId);
    this.closed = new Promise((resolve) => {
      this.resolveClosed = resolve;
    });
    let markSpawned = (): void => undefined;
    let rejectSpawn: (error: Error) => void = () => undefined;
    const spawned = new Promise<void>((resolve, reject) => {
      markSpawned = resolve;
      rejectSpawn = reject;
    });
    this.query = query({
      prompt: this.prompts,
      options: sessionOptions(
        input,
        this.abort,
        () => this.permissions.planning,
        (process) => {
          this.child = process;
          process.once('spawn', markSpawned);
          process.once('error', (error) => {
            rejectSpawn(error);
            this.childClosed(error);
          });
          const onExit = (code: number | null, signal: NodeJS.Signals | null): void => {
            let error: Error | undefined;
            if (signal) error = new Error(`Session process was killed (${signal}).`);
            else if (code !== 0)
              error = new Error(`Session process exited with code ${String(code)}.`);
            this.childClosed(error);
          };
          process.once('exit', onExit);
          process.once('close', onExit);
        },
      ),
    }) as SteeringQuery;
    this.initialized = this.query.initializationResult().then(
      async () => {
        this.abort.signal.throwIfAborted();
        await this.permissions.initialize(this.query);
        this.abort.signal.throwIfAborted();
        this.initializing = false;
      },
      (error: unknown) => {
        this.abort.signal.throwIfAborted();
        this.initializing = false;
        const failure = new Error(errMsg(error));
        this.finish(failure);
        throw failure;
      },
    );
    // Startup can fail before a turn observes it. The turn or the lifecycle's
    // closure observer reports the failure without an unhandled rejection.
    void this.initialized.catch(() => undefined);
    this.catalog = new ClaudeCatalog(this.query, this.initialized);
    // A CLI that fails before it reaches spawn still settles initialization,
    // which is what releases the open instead of leaving it hanging.
    this.spawned = Promise.race([spawned, this.initialized]);
    void this.pump();
  }

  // Returns as soon as the CLI process exists, so the session reaches the
  // lifecycle with a pid to track while the CLI is still booting behind it.
  async start(): Promise<void> {
    await this.spawned;
  }

  onBackgroundEvent(listener: (event: NormalizedEvent) => void): () => void {
    this.backgroundListeners.add(listener);
    return () => {
      this.backgroundListeners.delete(listener);
    };
  }

  get isClosed(): boolean {
    return this.abort.signal.aborted;
  }

  get process(): { pid: number; isAlive(): boolean } | undefined {
    const child = this.child;
    const pid = child?.pid;
    if (child === undefined || pid === undefined) return undefined;
    return { pid, isAlive: () => child.exitCode === null && !child.killed };
  }

  catalogItems(): Promise<SkillInfo[]> {
    return this.catalog.catalogItems();
  }

  onCatalogUpdated(listener: (items: SkillInfo[]) => void): () => void {
    return this.catalog.onUpdated(listener);
  }

  async *stream(prompt: string): AsyncGenerator<NormalizedEvent, void, undefined> {
    if (this.activeTurnId) throw new Error('This Claude session is already running a turn.');
    const turnId = randomUUID();
    this.activeTurnId = turnId;
    this.mapper.beginTurn(turnId);
    const turnQueue = (this.turnQueue = new MessageQueue<{
      message: SDKMessage;
      events: NormalizedEvent[];
    }>());
    let reportedPlanningModel = false;
    try {
      await this.waitUntilInitialized();
      const notice = this.permissions.takeNotice();
      if (notice) yield this.mapper.statusEvent(notice);
      this.prompts.push({
        type: 'user',
        uuid: turnId,
        session_id: this.providerSessionId,
        parent_tool_use_id: null,
        message: { role: 'user', content: prompt },
      });
      this.steerable = !isSlashCommand(prompt);
      for (;;) {
        const next = await turnQueue.next();
        // An exhausted stream is a failure, unless Stop closed it on a turn
        // that already had its answer.
        if (next.done) {
          if (!this.turnAnswered) throw new Error('Claude Code exited before the turn finished.');
          yield { done: true };
          return;
        }
        const { message, events } = next.value;
        if (message.type === 'assistant' && !reportedPlanningModel) {
          const notice = this.permissions.planning
            ? planningModelNotice(message, this.modelId)
            : undefined;
          if (notice) {
            reportedPlanningModel = true;
            yield this.mapper.statusEvent(notice);
          }
        }
        yield* events;
        const lifecycle = commandLifecycle(message);
        if (lifecycle?.state === 'started') this.settleSteer(lifecycle.uuid, true);
        if (lifecycle?.state === 'cancelled') this.settleSteer(lifecycle.uuid, false);
        // A local slash command bypasses the model loop and publishes this one
        // terminal frame instead of a result for the ordinary turn path.
        if (message.type === 'system' && message.subtype === 'local_command_output') {
          yield { done: true };
          return;
        }
        // A refused usage window is answered with no result at all, so the turn
        // has to end here instead of waiting for one that never comes.
        if (message.type === 'rate_limit_event') {
          const refusal = rateLimitRefusal(message.rate_limit_info);
          if (refusal) throw refusal;
        }
        // The turn's own result, then that of each steer run as a CLI turn after it.
        if (message.type === 'result' && (this.turnAnswered || answersTurn(message, turnId))) {
          // A stopped turn settles quietly: the CLI still reports the
          // interruption as an error result carrying an internal diagnostic.
          if (message.subtype !== 'success' && this.interruptedTurnId !== turnId)
            throw new Error(turnFailure(message.subtype, message.errors));
          this.turnAnswered = true;
          for (const uuid of message.user_message_uuids ?? []) this.settleSteer(uuid, true);
        }
        // Once answered, the turn ends when a result or a cancellation leaves no
        // steer waiting to start. A stopped turn does not wait, nor does a CLI
        // too old to list what a result answered.
        if (
          this.turnAnswered &&
          (message.type === 'result' || lifecycle?.state === 'cancelled') &&
          (this.steerDeliveries.size === 0 ||
            this.interruptedTurnId === turnId ||
            (message.type === 'result' && !message.user_message_uuids))
        ) {
          this.steerable = false;
          yield { done: true };
          return;
        }
      }
    } finally {
      this.activeTurnId = undefined;
      this.steerable = false;
      this.turnAnswered = false;
      if (this.turnQueue === turnQueue) this.turnQueue = undefined;
      await Promise.all([...this.steerDeliveries.keys()].map((uuid) => this.withdrawSteer(uuid)));
    }
  }

  // Hands the prompt to the running turn: the CLI folds it in at the next tool
  // boundary, or runs it right after the turn's result. Resolves true once the
  // model has it. The CLI resolves a slash command itself, so that can only
  // run as a turn of its own.
  steer(text: string): Promise<boolean> {
    if (!this.steerable || this.isClosed || isSlashCommand(text)) return Promise.resolve(false);
    const uuid = randomUUID();
    const delivered = new Promise<boolean>((resolve) => {
      this.steerDeliveries.set(uuid, resolve);
    });
    this.prompts.push({
      type: 'user',
      uuid,
      session_id: this.providerSessionId,
      parent_tool_use_id: null,
      message: { role: 'user', content: text },
      priority: 'next',
    });
    return delivered;
  }

  private settleSteer(uuid: string, delivered: boolean): void {
    this.steerDeliveries.get(uuid)?.(delivered);
    this.steerDeliveries.delete(uuid);
  }

  // A steer the turn ended without is withdrawn so the session layer can send
  // it again. Unless the CLI says it cancelled it, the CLI may still run it,
  // and losing one steer on a failed turn beats showing it twice.
  private async withdrawSteer(uuid: string): Promise<void> {
    const cancelled =
      this.isClosed || (await this.query.cancelAsyncMessage(uuid).catch(() => false));
    this.settleSteer(uuid, !cancelled);
  }

  // Keep reading between turns so background children can settle immediately.
  private async pump(): Promise<void> {
    try {
      for (;;) {
        this.requireOpen();
        const next = this.query.next().catch((error: unknown) => {
          // Closing the iterator may race the initialization failure that caused it.
          this.requireOpen();
          throw error;
        });
        // Observe both promises even when closing the query settles its
        // iterator first, so a boot failure surfaces instead of hanging here.
        if (this.initializing) await Promise.race([this.initialized, next]);
        const result = await next;
        this.requireOpen();
        if (result.done) {
          throw new Error('Claude Code exited before the turn finished.');
        }
        this.dispatch(result.value);
      }
    } catch (error) {
      this.finish(error instanceof Error ? error : new Error(errMsg(error)));
    }
  }

  private dispatch(message: SDKMessage): void {
    this.catalog.observe(message);
    // Mapping stays in wire order, including model and spawn-link observations.
    const events = this.mapper.map(message, this.fastMode);
    const turnEvents: NormalizedEvent[] = [];
    for (const event of events) {
      if (event.childSession) {
        for (const listener of this.backgroundListeners) listener(event);
      } else turnEvents.push(event);
    }
    this.turnQueue?.push({ message, events: turnEvents });
  }

  async setAutonomy(autonomy: Autonomy): Promise<void> {
    await this.permissions.change(this.query, this.initialized, () => ({
      autonomy,
      planning: this.permissions.planning,
    }));
    this.publishPermissionNotice();
  }

  async setInteractionMode(mode: SessionInteractionMode): Promise<void> {
    await this.permissions.change(this.query, this.initialized, () => ({
      autonomy: this.permissions.selection(),
      planning: mode === 'spec',
    }));
    this.publishPermissionNotice();
  }

  private publishPermissionNotice(): void {
    if (this.backgroundListeners.size === 0) return;
    const notice = this.permissions.takeNotice();
    if (!notice) return;
    const event = this.mapper.statusEvent(notice);
    for (const listener of this.backgroundListeners) listener(event);
  }

  // Model and effort stay on this process, never in the user's settings files.
  // Replaying an already-applied model needs no API validation request.
  async setModel({
    modelId,
    reasoningEffort,
    fastMode,
    contextWindowTokens,
  }: ProviderModelSettings): Promise<void> {
    await this.waitUntilInitialized();
    const resolvedModel = claudeLaunchModel(
      modelId === undefined ? this.modelId : (modelId ?? undefined),
      contextWindowTokens ?? this.input.contextWindowTokens,
      this.input.models,
      this.input.defaultModel,
    );
    if (modelId !== undefined && resolvedModel !== this.modelId) {
      await this.query.setModel(resolvedModel);
      this.requireOpen();
      this.modelId = resolvedModel;
      this.mapper.setModel(this.modelId);
    }
    this.requireOpen();
    if (fastMode !== undefined) {
      await this.query.applyFlagSettings({ fastMode });
      this.requireOpen();
      this.fastMode = fastMode;
    }
    // Leaving ultra clears the flag instead of writing `false`, which is what
    // turns ultracode off while keeping the level chosen alongside it. A model
    // without levels clears both, so the previous model's do not follow it.
    if (reasoningEffort === null)
      await this.query.applyFlagSettings({ effortLevel: null, ultracode: null });
    const effort = claudeEffort(reasoningEffort ?? undefined);
    if (effort)
      await this.query.applyFlagSettings({
        effortLevel: effort.effortLevel,
        ultracode: effort.ultracode ? true : null,
      });
  }

  private requireOpen(): void {
    if (this.failure) throw this.failure;
    this.abort.signal.throwIfAborted();
  }

  private async waitUntilInitialized(): Promise<void> {
    this.requireOpen();
    await this.initialized;
    this.requireOpen();
  }

  async interrupt(): Promise<void> {
    const turnId = this.activeTurnId;
    if (!turnId) return;
    // A second Stop during boot releases a CLI that never initializes.
    if (this.initializing && this.interruptedTurnId === turnId) {
      await this.close();
      return;
    }
    this.interruptedTurnId = turnId;
    try {
      await this.initialized;
    } catch {
      // The turn or closure observer owns startup failure diagnostics.
      return;
    }
    if (this.abort.signal.aborted || this.activeTurnId !== turnId) return;
    // Aborts the in-flight turn on the live process; the turn then settles with
    // its own result, so the next prompt does not pay for a restart. Steers not
    // yet delivered are cancelled with it rather than left to run unobserved.
    const receipt = await this.query.interrupt({ cancelQueued: true });
    for (const uuid of receipt?.cancelled ?? []) this.settleSteer(uuid, false);
    // A turn that already has its answer may be waiting only on steers the CLI
    // had not started. An idle CLI says nothing more, so the turn ends here.
    if (this.turnAnswered && this.activeTurnId === turnId) {
      for (const uuid of this.steerDeliveries.keys()) this.settleSteer(uuid, false);
      this.turnQueue?.close();
    }
  }

  close(): Promise<void> {
    this.finish();
    return Promise.resolve();
  }

  private childClosed(error?: Error): void {
    if (this.abort.signal.aborted) return;
    if (!this.initializing) {
      this.finish(error);
      return;
    }
    // Initialization owns the startup diagnostic, even if exit arrives first.
    void this.initialized.then(
      () => {
        this.finish(error);
      },
      () => undefined,
    );
  }

  private finish(error?: Error): void {
    if (this.abort.signal.aborted) return;
    this.failure = error;
    this.abort.abort();
    this.catalog.close();
    this.prompts.close();
    this.turnQueue?.close(error);
    this.backgroundListeners.clear();
    // The SDK closes stdin and escalates SIGTERM to SIGKILL itself.
    try {
      this.query.close();
    } finally {
      this.resolveClosed(error);
    }
  }
}
