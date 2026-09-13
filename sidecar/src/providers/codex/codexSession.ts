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
  commandApproval,
  decideApproval,
  fileChangeApproval,
  type ApprovalDecision,
  type CodexApproval,
  type CommandApproval,
  type FileChangeApproval,
  type RequestedQuestion,
} from './codexApprovals.js';
import { CodexEventMapper, MAPPED_NOTIFICATIONS } from './codexEvents.js';
import { TurnStream } from './codexTurn.js';

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
  // The model the thread actually resolved to, which is what a reset goes back to.
  model: string;
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
  private threadModel?: string;
  private turnId?: string;
  private turn?: TurnStream;
  // Approval and question cards this session is still waiting on, so a turn
  // that ends first can take them off the screen.
  private openPrompts = 0;

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
    // `serverRequest/resolved` is not one of them: Codex sends it for the
    // requests this client itself just answered, so acting on it would cancel
    // live cards. It only matters when a second client shares the thread.
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
    this.threadModel = response.model;
  }

  async *stream(prompt: string): AsyncGenerator<NormalizedEvent, void, undefined> {
    if (this.turn) throw new Error('This Codex session is already running a turn.');
    const threadId = this.threadId;
    if (!threadId) throw new Error('This Codex session has no thread to run a turn on.');
    const turn = new TurnStream();
    this.turn = turn;
    try {
      const { approvalPolicy, sandbox } = codexAutonomy(this.autonomy);
      // A turn's overrides stick to the thread, so a cleared model has to name
      // the thread's own model rather than leave the last override in place.
      const model = this.model.modelId ?? this.threadModel;
      const started = await this.client.request<TurnResponse>('turn/start', {
        threadId,
        input: [{ type: 'text', text: prompt }],
        approvalPolicy,
        sandboxPolicy: codexSandboxPolicy(sandbox),
        ...(model ? { model } : {}),
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
      this.settlePrompts();
    });
    this.client.onRequest('item/commandExecution/requestApproval', (params) =>
      this.decide(commandApproval(params as CommandApproval)),
    );
    this.client.onRequest('item/fileChange/requestApproval', (params) => {
      const request = params as FileChangeApproval;
      return this.decide(fileChangeApproval(request, this.mapper.toolDetail(request.itemId)));
    });
    this.client.onRequest('item/tool/requestUserInput', async (params) => ({
      answers: await this.prompt(() =>
        answerQuestions(
          this.interactions,
          (params as { questions: RequestedQuestion[] }).questions,
        ),
      ),
    }));
  }

  private settle(turn: CompletedTurn['turn']): void {
    this.settlePrompts();
    if (turn.status === 'failed') {
      this.turn?.fail(new Error(turn.error?.message ?? 'Codex ended the turn with an error.'));
      return;
    }
    // An interrupted turn settles quietly; the user asked for it.
    if (turn.status === 'completed') this.turn?.push([{ done: true }]);
    this.turn?.finish();
  }

  // The turn ended with a card still open: settling only Codex's side would
  // leave the prompt and its waiter behind, under the next turn.
  private settlePrompts(): void {
    if (this.openPrompts > 0) this.interactions.cancelPending();
  }

  private async prompt<T>(ask: () => Promise<T>): Promise<T> {
    this.openPrompts += 1;
    try {
      return await ask();
    } finally {
      this.openPrompts -= 1;
    }
  }

  private async decide(approval: CodexApproval): Promise<{ decision: ApprovalDecision }> {
    return {
      decision: await this.prompt(() =>
        decideApproval(this.providerSessionId, this.interactions, approval),
      ),
    };
  }
}
