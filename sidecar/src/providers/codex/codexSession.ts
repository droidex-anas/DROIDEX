// One `codex app-server` process per DROIDEX session, holding one thread. Turns
// run on that thread; model, effort and autonomy ride on each `turn/start`,
// which Codex applies to that turn and the ones after it.
import type { NormalizedEvent } from '../../normalize.js';
import type { Autonomy } from '../../protocol.js';
import type { ProviderInteractions } from '../interactions.js';
import type { ProviderModelSettings, ProviderSession } from '../session.js';
import { initialize, type AppServerClient } from './appServer.js';
import {
  answerQuestions,
  codexAutonomy,
  codexSandboxPolicy,
  decideApproval,
  type ApprovalDecision,
  type RequestedQuestion,
} from './codexApprovals.js';
import { CodexEventMapper, MAPPED_NOTIFICATIONS } from './codexEvents.js';

export interface CodexSessionInput {
  // DROIDEX's own identity for the session. Codex mints its thread id itself,
  // which the session carries separately as its resume handle.
  appSessionId: string;
  client: AppServerClient;
  cwd: string;
  autonomy: Autonomy;
  model: ProviderModelSettings;
  interactions: ProviderInteractions;
}

interface ThreadResponse {
  thread: { id: string };
}

interface TurnResponse {
  turn: { id: string };
}

interface CompletedTurn {
  turn: { id: string; status: string; error: { message: string } | null };
}

export class CodexSession implements ProviderSession {
  readonly provider = 'codex' as const;
  readonly providerSessionId: string;

  private readonly client: AppServerClient;
  private readonly mapper: CodexEventMapper;
  private readonly interactions: ProviderInteractions;
  private readonly cwd: string;
  private autonomy: Autonomy;
  private model: ProviderModelSettings;
  private threadId?: string;
  private turnId?: string;
  private turn?: TurnStream;

  constructor(input: CodexSessionInput) {
    this.providerSessionId = input.appSessionId;
    this.client = input.client;
    this.interactions = input.interactions;
    this.cwd = input.cwd;
    this.autonomy = input.autonomy;
    this.model = input.model;
    this.mapper = new CodexEventMapper(input.appSessionId);
    // Registered before `initialize`, so nothing the server sends can arrive
    // before its handler exists. Requests left unregistered — the legacy exec
    // and patch callbacks, additional permissions, MCP elicitation — are
    // answered with method-not-found by the transport, never granted.
    this.registerHandlers();
  }

  // Codex owns its thread ids, so this is the handle a restart resumes from.
  get resumeId(): string | undefined {
    return this.threadId;
  }

  get process(): { pid: number; isAlive(): boolean } | undefined {
    const pid = this.client.pid;
    if (pid === undefined) return undefined;
    return { pid, isAlive: () => this.client.isAlive() };
  }

  // Opens the session's thread: a new one, or the stored one it is resuming.
  // A thread Codex cannot load is a visible failure; starting a fresh thread
  // under the same identity would silently lose the conversation.
  async open(resumeId?: string): Promise<void> {
    await initialize(this.client);
    const { approvalPolicy, sandbox } = codexAutonomy(this.autonomy);
    const settings = {
      cwd: this.cwd,
      approvalPolicy,
      sandbox,
      ...(this.model.modelId ? { model: this.model.modelId } : {}),
    };
    const response = await (resumeId
      ? this.client.request<ThreadResponse>('thread/resume', {
          threadId: resumeId,
          // The stored transcript is DROIDEX's scrollback; Codex only has to
          // reload the thread's own history for the model.
          excludeTurns: true,
          ...settings,
        })
      : this.client.request<ThreadResponse>('thread/start', settings));
    this.threadId = response.thread.id;
  }

  async *stream(prompt: string): AsyncGenerator<NormalizedEvent, void, undefined> {
    if (this.turn) throw new Error('This Codex session is already running a turn.');
    const threadId = this.threadId;
    if (!threadId) throw new Error('This Codex session has no thread to run a turn on.');
    const turn = new TurnStream();
    this.turn = turn;
    try {
      const { approvalPolicy, sandbox } = codexAutonomy(this.autonomy);
      const started = await this.client.request<TurnResponse>('turn/start', {
        threadId,
        input: [{ type: 'text', text: prompt }],
        approvalPolicy,
        sandboxPolicy: codexSandboxPolicy(sandbox),
        ...(this.model.modelId ? { model: this.model.modelId } : {}),
        ...(this.model.reasoningEffort ? { effort: this.model.reasoningEffort } : {}),
      });
      this.turnId = started.turn.id;
      yield* turn.drain();
    } finally {
      this.turn = undefined;
      this.turnId = undefined;
    }
  }

  // Both ride on the next `turn/start`, which is where Codex takes them.
  setAutonomy(autonomy: Autonomy): Promise<void> {
    this.autonomy = autonomy;
    return Promise.resolve();
  }

  setModel(settings: ProviderModelSettings): Promise<void> {
    this.model = settings;
    return Promise.resolve();
  }

  async interrupt(): Promise<void> {
    const threadId = this.threadId;
    const turnId = this.turnId;
    // A stale pair would end a turn that already settled, or none at all.
    if (!threadId || !turnId) return;
    await this.client.request('turn/interrupt', { threadId, turnId });
  }

  close(): Promise<void> {
    return this.client.close();
  }

  private registerHandlers(): void {
    for (const method of MAPPED_NOTIFICATIONS) {
      this.client.onNotification(method, (params) => {
        this.turn?.push(this.mapper.map(method, params));
      });
    }
    this.client.onNotification('turn/started', (params) => {
      this.turnId = (params as TurnResponse).turn.id;
    });
    this.client.onNotification('turn/completed', (params) => {
      this.settle((params as CompletedTurn).turn);
    });
    this.client.onNotification('error', (params) => {
      const { error, willRetry } = params as { error: { message: string }; willRetry: boolean };
      this.turn?.push([this.mapper.errorEvent(error.message)]);
      // A retrying error is a hiccup the turn recovers from on its own.
      if (!willRetry) this.turn?.fail(new Error(error.message));
    });
    this.client.onClose((error) => {
      this.turn?.fail(error);
    });
    this.client.onRequest('item/commandExecution/requestApproval', (params) =>
      this.approveCommand(params as CommandApproval),
    );
    this.client.onRequest('item/fileChange/requestApproval', (params) =>
      this.approveFileChange(params as FileChangeApproval),
    );
    this.client.onRequest('item/tool/requestUserInput', async (params) => ({
      answers: await answerQuestions(
        this.interactions,
        (params as { questions: RequestedQuestion[] }).questions,
      ),
    }));
  }

  private settle(turn: CompletedTurn['turn']): void {
    if (turn.status === 'failed') {
      this.turn?.fail(new Error(turn.error?.message ?? 'Codex ended the turn with an error.'));
      return;
    }
    // An interrupted turn settles quietly; the user asked for it.
    if (turn.status === 'completed') this.turn?.push([{ done: true }]);
    this.turn?.finish();
  }

  private async approveCommand(params: CommandApproval): Promise<{ decision: ApprovalDecision }> {
    const command = params.command ?? params.commandActions?.map((a) => a.command).join('; ') ?? '';
    return {
      decision: await decideApproval(this.providerSessionId, this.interactions, {
        kind: 'exec',
        title: 'Bash',
        detail: params.reason ? `${command}\n\n${params.reason}` : command,
        ...(command ? { signature: `exec::${command}` } : {}),
        raw: params,
      }),
    };
  }

  // The request itself carries no description of the patch, so the open item
  // the mapper is tracking is the only thing that can describe it.
  private async approveFileChange(
    params: FileChangeApproval,
  ): Promise<{ decision: ApprovalDecision }> {
    const files = this.mapper.toolDetail(params.itemId);
    return {
      decision: await decideApproval(this.providerSessionId, this.interactions, {
        kind: 'edit',
        title: 'Edit',
        detail: params.reason ? `${files ?? ''}\n\n${params.reason}` : (files ?? 'File changes'),
        ...(files ? { signature: `edit::${files}` } : {}),
        raw: params,
      }),
    };
  }
}

interface CommandApproval {
  itemId: string;
  command?: string | null;
  reason?: string | null;
  commandActions?: { command: string }[] | null;
}

interface FileChangeApproval {
  itemId: string;
  reason?: string | null;
}

// One turn's events, filled by the notification handlers and drained by the
// turn that is streaming. Events that arrive outside a turn have no transcript
// to land in and are dropped.
class TurnStream {
  private readonly queued: NormalizedEvent[] = [];
  private waiting?: () => void;
  private settlement?: Error | 'done';

  push(events: NormalizedEvent[]): void {
    this.queued.push(...events);
    this.wake();
  }

  finish(): void {
    this.settlement ??= 'done';
    this.wake();
  }

  // First settlement wins: whichever of the failing error notification, the
  // failed turn or the dead process arrives first is the turn's cause.
  fail(error: Error): void {
    this.settlement ??= error;
    this.wake();
  }

  async *drain(): AsyncGenerator<NormalizedEvent, void, undefined> {
    for (;;) {
      const next = this.queued.shift();
      if (next) {
        yield next;
        continue;
      }
      if (this.settlement === 'done') return;
      if (this.settlement) throw this.settlement;
      await new Promise<void>((resolve) => {
        this.waiting = resolve;
      });
    }
  }

  private wake(): void {
    const waiting = this.waiting;
    this.waiting = undefined;
    waiting?.();
  }
}
