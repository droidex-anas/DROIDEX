// One `codex app-server` process per DROIDEX session, holding one thread. Turns
// run on that thread; model, effort and autonomy ride on each `turn/start`,
// which Codex applies to that turn and the ones after it.
import type { NormalizedEvent } from '../../normalize.js';
import type { Autonomy } from '../../protocol.js';
import type { ProviderMention, SkillInfo } from '../catalog.js';
import type { ProviderInteractions } from '../interactions.js';
import type { ProviderModelSettings, ProviderSession } from '../session.js';
import type { AppServerClient } from './appServer.js';
import { codexAutonomy, codexSandboxPolicy, OpenPrompts } from './codexApprovals.js';
import { CodexCatalog } from './codexCatalog.js';
import {
  CodexEventMapper,
  errorOf,
  isObject,
  MAPPED_NOTIFICATIONS,
  turnOf,
  type CodexTurn,
} from './codexEvents.js';
import { CodexStartup } from './codexStartup.js';
import { CodexVoice } from './codexVoice.js';
import { TurnStream, turnInput, turnStartParams } from './codexTurn.js';

const STARTUP_QUIET_MS = 40;

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

export class CodexSession implements ProviderSession {
  readonly provider = 'codex' as const;
  readonly providerSessionId: string;
  readonly closed: Promise<Error | undefined>;
  // Codex can hold a voice conversation on this thread; the client does the
  // audio and this only relays the handshake and the transcript.
  readonly voice: CodexVoice;

  private resolveClosed: (error?: Error) => void = () => undefined;
  private hasClosed = false;
  private closePromise?: Promise<void>;
  private readonly client: AppServerClient;
  private readonly mapper: CodexEventMapper;
  private readonly cwd: string;
  private autonomy: Autonomy;
  private model: ProviderModelSettings;
  private threadId?: string;
  private threadModel?: string;
  private turnId?: string;
  private turn?: TurnStream;
  // Stop pressed before `turn/start` answered: there is a turn to end but no id
  // to name it with yet.
  private pendingInterrupt = false;
  // A turn Codex started by itself, for a request spoken to a voice
  // conversation. It has no stream of its own, so its id is kept here: Stop has
  // to reach it, and its completion must not settle a turn the user typed.
  private delegatedTurnId?: string;
  // The chat asked for the model's own effort, which the thread has to be told
  // explicitly; an omitted effort would leave the previous one in place.
  private effortCleared = false;
  private readonly prompts: OpenPrompts;
  private readonly startup = new CodexStartup();
  private readonly backgroundListeners = new Set<(event: NormalizedEvent) => void>();
  private readonly delegatedListeners = new Set<(running: boolean) => void>();
  private startupNoticeTimer?: ReturnType<typeof setTimeout>;
  private catalog?: CodexCatalog;

  constructor(input: CodexSessionInput) {
    this.providerSessionId = input.appSessionId;
    this.closed = new Promise((resolve) => {
      this.resolveClosed = (error) => {
        this.hasClosed = true;
        resolve(error);
      };
    });
    this.client = input.client;
    this.cwd = input.cwd;
    this.autonomy = input.autonomy;
    this.model = input.model;
    this.mapper = new CodexEventMapper(input.appSessionId, input.model);
    this.voice = new CodexVoice(
      this.client,
      () => this.threadId,
      () => this.applyThreadSettings(),
    );
    this.prompts = new OpenPrompts(input.appSessionId, input.interactions);
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

  get isClosed(): boolean {
    return this.hasClosed;
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
    this.mapper.setModel({ ...this.model, modelId: this.model.modelId ?? this.threadModel });
    this.catalog ??= new CodexCatalog(this.client, [this.cwd]);
    await this.pushThreadSettings();
  }

  catalogItems(): Promise<SkillInfo[]> {
    return this.requireCatalog().catalogItems();
  }

  onCatalogUpdated(listener: (items: SkillInfo[]) => void): () => void {
    return this.requireCatalog().onUpdated(listener);
  }

  private requireCatalog(): CodexCatalog {
    if (!this.catalog) throw new Error('This Codex session is not open.');
    return this.catalog;
  }

  async *stream(
    prompt: string,
    mentions?: ProviderMention[],
  ): AsyncGenerator<NormalizedEvent, void, undefined> {
    if (this.turn) throw new Error('This Codex session is already running a turn.');
    // Codex runs one turn per thread, and a spoken request is a turn like any
    // other. Starting a second one here would pull the delegated turn's events
    // into this stream and leave the spoken request unanswered.
    if (this.delegatedTurnId)
      throw new Error('This Codex session is working on a spoken request; it has to finish first.');
    const threadId = this.threadId;
    if (!threadId) throw new Error('This Codex session has no thread to run a turn on.');
    const turn = new TurnStream();
    this.turn = turn;
    this.pendingInterrupt = false;
    try {
      // The thread's own startup may still be running behind this turn; what is
      // left of it is announced now rather than leaving the chat silent.
      this.announceStartup();
      const started = await this.client.request<{ turn: CodexTurn }>(
        'turn/start',
        turnStartParams(threadId, prompt, mentions, {
          autonomy: this.autonomy,
          model: this.model,
          ...(this.threadModel ? { threadModel: this.threadModel } : {}),
        }),
      );
      this.adoptTurn(started.turn.id);
      yield* turn.drain();
    } finally {
      // Releases a waiter left parked when the consumer stops reading early.
      this.cancelStartupNotice();
      turn.finish();
      this.turn = undefined;
      this.turnId = undefined;
      this.pendingInterrupt = false;
    }
  }

  // A typed turn takes the autonomy on its own `turn/start`. A turn Codex
  // starts for a spoken request has none, so the thread is told as well:
  // otherwise a chat turned down to ask-first would still act unattended when
  // spoken to. This one does not swallow: the caller declines to publish a
  // level the thread never took, and the session keeps the one it still has.
  async setAutonomy(autonomy: Autonomy): Promise<void> {
    const previous = this.autonomy;
    this.autonomy = autonomy;
    try {
      await this.applyThreadSettings();
    } catch (error) {
      this.autonomy = previous;
      throw error;
    }
  }

  async setModel(settings: ProviderModelSettings): Promise<void> {
    // An omitted field keeps its value; only what the caller named changes.
    // A cleared effort leaves `turn/start` to the model's own.
    const model = { ...this.model };
    if (settings.modelId !== undefined) model.modelId = settings.modelId;
    if (settings.reasoningEffort === null) {
      delete model.reasoningEffort;
      // Omitting it would leave the thread on the effort it already had, so
      // the reset has to be said out loud the next time settings are applied.
      this.effortCleared = true;
    } else if (settings.reasoningEffort) {
      model.reasoningEffort = settings.reasoningEffort;
      this.effortCleared = false;
    }
    this.model = model;
    this.mapper.setModel({ ...this.model, modelId: this.model.modelId ?? this.threadModel });
    await this.pushThreadSettings();
  }

  // The chat's settings on the thread itself. A typed turn carries these on
  // its own `turn/start`, so this is what decides how a turn Codex starts by
  // itself, for a spoken request, runs: which model, at which effort, whether
  // it stops to ask, and what it is allowed to touch. The policy and the
  // sandbox travel together, the way `turn/start` sends them, because half an
  // autonomy level is worse than none: an unsandboxed turn that never asks, or
  // a sandboxed one that cannot ask for the escalation it needs.
  private async applyThreadSettings(): Promise<void> {
    const threadId = this.threadId;
    if (!threadId) return;
    const { modelId, reasoningEffort } = this.model;
    const { approvalPolicy, sandbox } = codexAutonomy(this.autonomy);
    // `null` is how the thread is told to go back to the model's own effort;
    // leaving the field out keeps whatever it had.
    const effort = reasoningEffort ?? (this.effortCleared ? null : undefined);
    await this.client.request('thread/settings/update', {
      threadId,
      approvalPolicy,
      sandboxPolicy: codexSandboxPolicy(sandbox),
      ...(modelId ? { model: modelId } : {}),
      ...(effort !== undefined ? { effort } : {}),
    });
  }

  // For the paths whose own work does not depend on this landing: the model
  // and effort ride `turn/start` anyway, and a conversation applies all of it
  // again before it opens, which is where the failure is worth reporting.
  private async pushThreadSettings(): Promise<void> {
    await this.applyThreadSettings().catch(() => undefined);
  }

  // Codex takes a prompt into the running turn instead of ending it. The turn
  // id is the server's own precondition, so a steer aimed at a turn that has
  // already settled is refused rather than applied to whatever runs now.
  async steer(text: string, mentions?: ProviderMention[]): Promise<void> {
    const threadId = this.threadId;
    // A turn started for a spoken request takes a typed prompt the same way,
    // so sending while the chat is working on one steers it rather than
    // stopping it.
    const turn = this.turn;
    const turnId = turn ? this.turnId : this.delegatedTurnId;
    if (!threadId || !turnId) throw new Error('This Codex session has no running turn to steer.');
    const steered = await this.client.request<{ turnId: string }>('turn/steer', {
      threadId,
      expectedTurnId: turnId,
      input: turnInput(text, mentions),
    });
    // A queued prompt may have started its own turn while this was in flight.
    // That turn owns its id, and Stop has to reach it rather than this one.
    if (!turn) {
      if (this.delegatedTurnId === turnId) this.setDelegatedTurn(steered.turnId);
      return;
    }
    if (this.turn === turn && this.turnId === turnId) this.turnId = steered.turnId;
  }

  async interrupt(): Promise<void> {
    if (!this.threadId) return;
    // Stop reaches a delegated turn by its own id: it is running on this
    // thread, and the user can see its work in the chat.
    if (!this.turn) {
      const delegated = this.delegatedTurnId;
      if (delegated) await this.sendInterrupt(delegated);
      return;
    }
    // A stale pair would end a turn that already settled, or none at all.
    if (!this.turnId) {
      this.pendingInterrupt = true;
      return;
    }
    await this.sendInterrupt(this.turnId);
  }

  close(): Promise<void> {
    this.resolveClosed();
    this.catalog?.close();
    this.cancelStartupNotice();
    return (this.closePromise ??= this.client.close());
  }

  // Every notification is read through a guard: a payload this build does not
  // recognize must not throw out of the transport's stdout listener, and one
  // addressed to another thread (a sub-agent Codex spawned for this one) is
  // not this session's to render or to adopt as its turn.
  private onThreadNotification(method: string, handler: (params: unknown) => void): void {
    this.client.onNotification(method, (params) => {
      if (this.isForAnotherThread(params)) return;
      handler(params);
    });
  }

  private isForAnotherThread(params: unknown): boolean {
    if (!this.threadId || !isObject(params)) return false;
    const { threadId } = params as { threadId?: unknown };
    return typeof threadId === 'string' && threadId !== this.threadId;
  }

  onDelegatedTurn(listener: (running: boolean) => void): () => void {
    this.delegatedListeners.add(listener);
    return () => {
      this.delegatedListeners.delete(listener);
    };
  }

  // Announced only when the answer changes, so a repeated notification does
  // not settle the same turn twice.
  private setDelegatedTurn(turnId: string | undefined): void {
    const was = this.delegatedTurnId !== undefined;
    this.delegatedTurnId = turnId;
    const running = turnId !== undefined;
    if (running === was) return;
    for (const listener of this.delegatedListeners) listener(running);
  }

  onBackgroundEvent(listener: (event: NormalizedEvent) => void): () => void {
    this.backgroundListeners.add(listener);
    return () => {
      this.backgroundListeners.delete(listener);
    };
  }

  private deliver(events: NormalizedEvent[]): void {
    for (const event of events) {
      // A turn Codex starts by itself — a spoken request delegated from a voice
      // conversation — has no stream waiting on it, so its work reaches the
      // chat the same way a child session's does.
      if (event.childSession || !this.turn) {
        for (const listener of this.backgroundListeners) listener(event);
      } else this.turn.push([event]);
    }
  }

  private registerHandlers(): void {
    this.client.onNotification('thread/started', (params) => {
      this.deliver(this.mapper.childThreadStarted(params, this.threadId));
    });
    for (const method of MAPPED_NOTIFICATIONS) {
      this.onThreadNotification(method, (params) => {
        const events = this.mapper.map(method, params);
        // Only mapped output counts as an answer, not unknown items or accounting.
        if (method.startsWith('item/') && events.length > 0) {
          this.startup.itemArrived();
          this.cancelStartupNotice();
        }
        this.deliver(events);
      });
    }
    this.client.onNotification('skills/changed', () => {
      this.catalog?.refreshSkills();
    });
    this.onThreadNotification('mcpServer/startupStatus/updated', (params) => {
      this.startup.serverStatus(params);
      this.announceStartup();
    });
    this.onThreadNotification('hook/started', () => {
      this.startup.hookStarted();
      this.announceStartup();
    });
    this.onThreadNotification('hook/completed', () => {
      this.startup.hookCompleted();
    });
    this.onThreadNotification('turn/started', (params) => {
      const turn = turnOf(params);
      if (!turn) return;
      if (this.turn) this.adoptTurn(turn.id);
      else this.setDelegatedTurn(turn.id);
    });
    this.onThreadNotification('turn/completed', (params) => {
      const turn = turnOf(params);
      if (!turn) return;
      if (turn.id === this.delegatedTurnId) {
        this.setDelegatedTurn(undefined);
        // Same as settle() does for a typed turn: an approval nobody can
        // answer any more leaves the screen with the turn that asked.
        this.prompts.cancel();
        return;
      }
      this.settle(turn);
    });
    this.onThreadNotification('error', (params) => {
      const failure = errorOf(params);
      if (!failure) return;
      // Through deliver(), so a turn Codex started for a spoken request
      // reports its failures in the chat too rather than stopping silently.
      this.deliver([this.mapper.errorEvent(failure.error)]);
      // A retrying error is a hiccup the turn recovers from on its own.
      if (!failure.willRetry) this.turn?.fail(failure.error);
    });
    this.client.onClose((error) => {
      this.cancelStartupNotice();
      this.catalog?.close();
      this.setDelegatedTurn(undefined);
      this.turn?.fail(error);
      this.prompts.cancel();
      this.resolveClosed(error);
    });
    this.prompts.register(this.client, (itemId: string) => this.mapper.toolDetail(itemId));
    // Codex can ask for things this build has no card for. They are refused at
    // the transport, and the chat says so: a silent refusal reads as the turn
    // stopping for no reason.
    this.client.onUnsupportedRequest((method, params) => {
      if (this.isForAnotherThread(params)) return;
      this.deliver([
        this.mapper.errorEvent(
          new Error(`Codex asked for ${method}, which DROIDEX cannot answer yet. It was refused.`),
        ),
      ]);
    });
  }

  // The turn's id arrives either on `turn/started` or with the `turn/start`
  // response, whichever lands first; a Stop that beat both goes out now.
  private adoptTurn(turnId: string): void {
    this.turnId = turnId;
    if (!this.pendingInterrupt) return;
    this.pendingInterrupt = false;
    // Nobody is waiting on this one, so a refused stop is reported in the turn
    // it belongs to — never in whichever turn happens to be open by then.
    const turn = this.turn;
    void this.sendInterrupt(turnId).catch((error: unknown) => {
      if (this.turn === turn) turn?.push([this.mapper.errorEvent(error)]);
    });
  }

  // Nothing to say outside a turn: there is no transcript for it to land in, and
  // holding the notice keeps it for the turn that is actually waiting.
  private announceStartup(): void {
    if (!this.turn || !this.startup.hasPendingNotices) return;
    // A microtask only sees one stdout chunk. Keep the burst open across chunks;
    // downstream bridge batching cannot amend a transcript row already emitted.
    if (this.startupNoticeTimer) {
      this.startupNoticeTimer.refresh();
      return;
    }
    this.startupNoticeTimer = setTimeout(() => {
      this.startupNoticeTimer = undefined;
      const turn = this.turn;
      if (!turn) return;
      const notices = this.startup.notices();
      if (notices.length > 0) turn.push(notices.map((text) => this.mapper.statusEvent(text)));
    }, STARTUP_QUIET_MS);
    this.startupNoticeTimer.unref();
  }

  private cancelStartupNotice(): void {
    clearTimeout(this.startupNoticeTimer);
    this.startupNoticeTimer = undefined;
  }

  private sendInterrupt(turnId: string): Promise<unknown> {
    return this.client.request('turn/interrupt', { threadId: this.threadId, turnId });
  }

  private settle(turn: CodexTurn): void {
    this.prompts.cancel();
    if (turn.status === 'failed') {
      this.turn?.fail(turn.error ?? new Error('Codex ended the turn with an error.'));
      return;
    }
    // An interrupted turn settles quietly; the user asked for it.
    if (turn.status === 'completed') this.turn?.push([{ done: true }]);
    this.turn?.finish();
  }
}
