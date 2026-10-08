// One `codex app-server` process per DROIDEX session, holding one thread. Turns
// run on that thread; model, effort and autonomy ride on each `turn/start`,
// which Codex applies to that turn and the ones after it.
import { randomUUID } from 'node:crypto';

import type { NormalizedEvent } from '../../normalize.js';
import type { SdkMcpServer } from '@factory/droid-sdk';
import type { Autonomy } from '../../protocol.js';
import type { ProviderMention, SkillInfo } from '../catalog.js';
import type { ProviderInteractions } from '../interactions.js';
import type {
  DelegatedTurnEnd,
  ProviderModelSettings,
  ProviderSession,
  UsageMetersListener,
} from '../session.js';
import type { AppServerClient } from './appServer.js';
import { codexAutonomy, codexSandboxPolicy, OpenPrompts } from './codexApprovals.js';
import { CodexCatalog } from './codexCatalog.js';
import { CodexRateLimits } from './codexRateLimits.js';
import { canApproveWorkspaceEdits } from './codexEditPermissions.js';
import {
  CodexEventMapper,
  errorOf,
  isObject,
  MAPPED_NOTIFICATIONS,
  mcpServerFailure,
  turnOf,
  type CodexTurn,
} from './codexEvents.js';
import { CodexToolBridge } from './codexTools.js';
import { CodexVoice } from './codexVoice.js';
import { TurnStream, turnInput, turnStartParams } from './codexTurn.js';

export interface CodexSessionInput {
  // DROIDEX's own identity for the session. Codex mints its thread id itself,
  // which the session carries separately as its resume handle.
  appSessionId: string;
  client: AppServerClient;
  cwd: string;
  autonomy: Autonomy;
  model: ProviderModelSettings;
  interactions: ProviderInteractions;
  inAppMcpServers?: SdkMcpServer[];
  onUsage?: UsageMetersListener;
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
  private turnAutonomy?: Autonomy;
  private model: ProviderModelSettings;
  private threadId?: string;
  private threadModel?: string;
  private turnId?: string;
  private turn?: TurnStream;
  // Stop pressed before `turn/start` answered: there is a turn to end but no id
  // to name it with yet.
  private pendingInterrupt = false;
  private interruption?: { turnId: string; interrupts: number };
  private failedTurnId?: string;
  // A turn Codex started by itself, for a request spoken to a voice
  // conversation. It has no stream of its own, so its id is kept here: Stop has
  // to reach it, and its completion must not settle a turn the user typed.
  private delegatedTurnId?: string;
  // The chat asked for the model's own effort, which the thread has to be told
  // explicitly; an omitted effort would leave the previous one in place.
  private effortCleared = false;
  private readonly prompts: OpenPrompts;
  private readonly tools: CodexToolBridge;
  private readonly backgroundListeners = new Set<(event: NormalizedEvent) => void>();
  private readonly delegatedListeners = new Set<
    (running: boolean, end?: DelegatedTurnEnd) => void
  >();
  // Steers waiting to send or held by the running turn, until Codex reports
  // delivery or the turn ends without them.
  private readonly steers = new Map<string, (delivered: boolean) => void>();
  private steerTail: Promise<void> = Promise.resolve();
  // A thread's MCP servers start before its first turn, so a notice about one
  // has no transcript to land in yet and waits for the turn that follows.
  private readonly heldNotices: NormalizedEvent[] = [];
  private catalog?: CodexCatalog;
  readonly usage: CodexRateLimits;

  constructor(input: CodexSessionInput) {
    this.providerSessionId = input.appSessionId;
    this.closed = new Promise((resolve) => {
      this.resolveClosed = (error) => {
        this.hasClosed = true;
        resolve(error);
      };
    });
    this.client = input.client;
    this.usage = new CodexRateLimits(this.client, input.onUsage);
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
    this.tools = new CodexToolBridge(input.inAppMcpServers ?? [], {
      appSessionId: input.appSessionId,
      interactions: input.interactions,
      threadId: () => this.threadId,
      turnId: () => {
        const turnId = this.turnId ?? this.delegatedTurnId;
        if (
          this.pendingInterrupt ||
          turnId === this.interruption?.turnId ||
          turnId === this.failedTurnId
        )
          return undefined;
        return turnId;
      },
      isLive: () => !this.hasClosed && input.interactions.isActive(),
      prompts: this.prompts,
    });
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
      serviceTier: this.model.fastMode ? 'priority' : 'default',
      ...(this.model.modelId ? { model: this.model.modelId } : {}),
    };
    const developerInstructions = await this.developerInstructions();
    const response = await (resumeId
      ? this.client.request<ThreadResponse>('thread/resume', {
          threadId: resumeId,
          // The stored transcript is DROIDEX's scrollback; Codex only has to
          // reload the thread's own history for the model.
          excludeTurns: true,
          ...settings,
          // Given again on resume: Codex keeps the tools with the thread but
          // not this override, so a resumed chat would lose it at compaction.
          ...(developerInstructions ? { developerInstructions } : {}),
        })
      : this.client.request<ThreadResponse>('thread/start', {
          ...settings,
          ...(this.tools.declarations.length
            ? { dynamicTools: this.tools.declarations, developerInstructions }
            : {}),
        }));
    this.threadId = response.thread.id;
    this.threadModel = response.model;
    this.mapper.setModel({ ...this.model, modelId: this.model.modelId ?? this.threadModel });
    this.catalog ??= new CodexCatalog(this.client, [this.cwd]);
    // Never awaited: the limits only add detail to a later refusal.
    void this.usage.read().catch(() => undefined);
    await this.pushThreadSettings();
  }

  // Codex takes developerInstructions in place of the configured ones, so the
  // user's own developer_instructions for this folder go first.
  private async developerInstructions(): Promise<string | undefined> {
    const note = this.tools.instructions;
    if (!note) return undefined;
    try {
      const { config } = await this.client.request<{
        config: { developer_instructions?: string | null };
      }>('config/read', { cwd: this.cwd });
      return [config.developer_instructions, note].filter(Boolean).join('\n\n');
    } catch {
      // A server that cannot parse the whole config refuses this request and
      // still runs chats, so the note goes alone rather than stopping one.
      return note;
    }
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
    this.mapper.beginTurn();
    this.turn = turn;
    this.turnAutonomy = this.autonomy;
    this.pendingInterrupt = false;
    this.interruption = undefined;
    this.failedTurnId = undefined;
    try {
      const started = await this.client.request<{ turn: CodexTurn }>(
        'turn/start',
        turnStartParams(threadId, prompt, mentions, {
          autonomy: this.autonomy,
          model: this.model,
          ...(this.threadModel ? { threadModel: this.threadModel } : {}),
        }),
      );
      this.adoptTurn(started.turn.id);
      // Only a turn that started can carry them; one that Codex refused would
      // have dropped them with it.
      if (this.heldNotices.length > 0) turn.push(this.heldNotices.splice(0));
      yield* turn.drain();
    } finally {
      turn.finish();
      // Settlement may already have let go, and a later turn may already own
      // these; only the turn that set them takes them away.
      if (this.turn === turn) {
        this.prompts.cancel();
        this.dropSteers();
        this.turn = undefined;
        this.turnAutonomy = undefined;
        this.turnId = undefined;
      }
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
    if (settings.fastMode !== undefined) model.fastMode = settings.fastMode;
    const previous = this.model;
    this.model = model;
    this.mapper.setModel({ ...this.model, modelId: this.model.modelId ?? this.threadModel });
    try {
      // Not swallowed: a turn Codex starts for a spoken request runs on what
      // the thread has, so a rejected write means the selection the chat shows
      // is not the one that would run.
      await this.applyThreadSettings();
    } catch (error) {
      this.model = previous;
      this.mapper.setModel({ ...this.model, modelId: this.model.modelId ?? this.threadModel });
      throw error;
    }
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
    const { reasoningEffort } = this.model;
    const { approvalPolicy, sandbox } = codexAutonomy(this.autonomy);
    // A cleared pin means the thread's own model, which is what the mapper and
    // `turn/start` already read it as. Omitting it would leave the thread on
    // the model the chat no longer names.
    const model = this.model.modelId ?? this.threadModel;
    // `null` is how the thread is told to go back to the model's own effort;
    // leaving the field out keeps whatever it had.
    const effort = reasoningEffort ?? (this.effortCleared ? null : undefined);
    await this.client.request('thread/settings/update', {
      threadId,
      approvalPolicy,
      sandboxPolicy: codexSandboxPolicy(sandbox),
      ...(model ? { model } : {}),
      ...(effort !== undefined ? { effort } : {}),
    });
  }

  // For the paths whose own work does not depend on this landing: the model
  // and effort ride `turn/start` anyway, and a conversation applies all of it
  // again before it opens, which is where the failure is worth reporting.
  private async pushThreadSettings(): Promise<void> {
    await this.applyThreadSettings().catch(() => undefined);
  }

  // Codex hands the prompt to the running turn at its next model request,
  // after the tool calls already in flight, and echoes it then as a user
  // message carrying the client id it was sent with. The turn id is the
  // server's own precondition, so a steer aimed at a turn that has already
  // settled is refused rather than applied to whatever runs now. A steer keeps
  // the turn's id, so Stop still reaches the same turn.
  steer(text: string, mentions?: ProviderMention[]): Promise<boolean> {
    const threadId = this.threadId;
    // A turn started for a spoken request takes a typed prompt the same way.
    const turnId = this.turn ? this.turnId : this.delegatedTurnId;
    if (
      !threadId ||
      !turnId ||
      this.hasClosed ||
      this.pendingInterrupt ||
      turnId === this.interruption?.turnId ||
      turnId === this.failedTurnId
    )
      return Promise.resolve(false);
    const clientUserMessageId = randomUUID();
    const delivered = new Promise<boolean>((resolve) => {
      this.steers.set(clientUserMessageId, resolve);
    });
    this.steerTail = this.steerTail.then(async () => {
      if (!this.steers.has(clientUserMessageId)) return;
      // A Stop can arrive while this steer waits. A sent steer can still be
      // delivered before the turn ends, but an unsent one stays withdrawn.
      if (turnId === this.interruption?.turnId) {
        this.settleSteer(clientUserMessageId, false);
        return;
      }
      try {
        // Delivery can beat the reply. Report it at once, but wait for both
        // before sending the next steer, even if the turn ends meanwhile.
        await this.client.request('turn/steer', {
          threadId,
          expectedTurnId: turnId,
          clientUserMessageId,
          input: turnInput(text, mentions),
        });
        await delivered;
      } catch {
        this.settleSteer(clientUserMessageId, false);
      }
    });
    return delivered;
  }

  private settleSteer(clientUserMessageId: string, delivered: boolean): void {
    this.steers.get(clientUserMessageId)?.(delivered);
    this.steers.delete(clientUserMessageId);
  }

  // A turn that ends, however it ends, drops the steers it never delivered.
  private dropSteers(): void {
    for (const clientUserMessageId of this.steers.keys())
      this.settleSteer(clientUserMessageId, false);
    // A reply Codex never sends would otherwise hold back every later steer.
    this.steerTail = Promise.resolve();
  }

  async interrupt(): Promise<void> {
    if (!this.threadId) return;
    this.prompts.cancel();
    // Stop reaches a delegated turn by its own id: it is running on this
    // thread, and the user can see its work in the chat.
    if (!this.turn) {
      const delegated = this.delegatedTurnId;
      if (delegated) await this.interruptTurn(delegated);
      return;
    }
    // A stale pair would end a turn that already settled, or none at all.
    if (!this.turnId) {
      this.pendingInterrupt = true;
      return;
    }
    await this.interruptTurn(this.turnId);
  }

  private async interruptTurn(turnId: string): Promise<void> {
    if (this.interruption?.turnId !== turnId) this.interruption = { turnId, interrupts: 0 };
    const interruption = this.interruption;
    // Pending and accepted Stops both block the turn; only a refusal releases its own claim.
    interruption.interrupts += 1;
    try {
      await this.client.request('turn/interrupt', { threadId: this.threadId, turnId });
    } catch (error) {
      interruption.interrupts -= 1;
      if (this.interruption === interruption && interruption.interrupts === 0)
        this.interruption = undefined;
      throw error;
    }
  }

  close(): Promise<void> {
    this.resolveClosed();
    this.dropSteers();
    this.prompts.cancel();
    this.catalog?.close();
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

  onDelegatedTurn(listener: (running: boolean, end?: DelegatedTurnEnd) => void): () => void {
    this.delegatedListeners.add(listener);
    return () => {
      this.delegatedListeners.delete(listener);
    };
  }

  // Announced only when the answer changes, so a repeated notification does
  // not settle the same turn twice.
  private setDelegatedTurn(turnId: string | undefined, end?: DelegatedTurnEnd): void {
    const was = this.delegatedTurnId !== undefined;
    this.delegatedTurnId = turnId;
    if (turnId && turnId !== this.interruption?.turnId) this.interruption = undefined;
    if (turnId && turnId !== this.failedTurnId) this.failedTurnId = undefined;
    const running = turnId !== undefined;
    if (running === was) return;
    for (const listener of this.delegatedListeners) listener(running, end);
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

  // Something the chat should keep that no turn asked for: it joins the turn
  // that is running, or waits for the next one.
  private notice(events: NormalizedEvent[]): void {
    if (events.length === 0) return;
    if (this.turn && this.turnId) this.turn.push(events);
    else this.heldNotices.push(...events);
  }

  private registerHandlers(): void {
    this.client.onRequest('item/tool/call', (params) => this.tools.call(params));
    this.client.onNotification('thread/started', (params) => {
      this.deliver(this.mapper.childThreadStarted(params, this.threadId));
    });
    for (const method of MAPPED_NOTIFICATIONS) {
      this.onThreadNotification(method, (params) => {
        if (method === 'item/started') this.settleDeliveredSteer(params);
        this.deliver(this.mapper.map(method, params));
      });
    }
    this.client.onNotification('skills/changed', () => {
      this.catalog?.refreshSkills();
    });
    // The account's, so it names no thread.
    this.client.onNotification('account/rateLimits/updated', (params) => {
      this.usage.update(params);
    });
    this.onThreadNotification('mcpServer/startupStatus/updated', (params) => {
      const failure = mcpServerFailure(params);
      if (failure) this.notice(this.mapper.mcpFailureEvents(failure));
    });
    this.onThreadNotification('turn/started', (params) => {
      const turn = turnOf(params, this.usage);
      if (!turn) return;
      // A typed turn owns this only while it is still waiting to be told its
      // id. Once it has one, a different id belongs to a turn Codex started
      // for itself, however close behind the typed one it arrives.
      if (this.turn && this.turnId === undefined) this.adoptTurn(turn.id);
      else if (turn.id !== this.turnId) this.setDelegatedTurn(turn.id);
    });
    this.onThreadNotification('turn/completed', (params) => {
      const turn = turnOf(params, this.usage);
      if (!turn) return;
      if (turn.id === this.delegatedTurnId) {
        this.dropSteers();
        this.setDelegatedTurn(undefined, delegatedTurnEnd(turn));
        // Same as settle() does for a typed turn: an approval nobody can
        // answer any more leaves the screen with the turn that asked.
        this.prompts.cancel();
        return;
      }
      this.settle(turn);
    });
    this.onThreadNotification('error', (params) => {
      const failure = errorOf(params, this.usage);
      if (!failure) return;
      // Through deliver(), so a turn Codex started for a spoken request
      // reports its failures in the chat too rather than stopping silently.
      this.deliver([this.mapper.errorEvent(failure.error)]);
      // A retrying error is a hiccup the turn recovers from on its own.
      if (failure.willRetry) return;
      // Resetting the queue must not let another steer reuse the failed turn.
      this.failedTurnId = this.turnId ?? this.delegatedTurnId;
      this.dropSteers();
      this.turn?.fail(failure.error);
    });
    this.client.onClose((error, cleanExit) => {
      this.catalog?.close();
      // Not announced: the close path owns what happens to the queue, and a
      // settlement here would start the next prompt on a client that is gone.
      this.delegatedTurnId = undefined;
      this.dropSteers();
      // A turn still in flight when the process goes away has failed, however
      // the process ended; an idle chat only records a death that was abnormal.
      this.turn?.fail(error);
      this.prompts.cancel();
      this.resolveClosed(cleanExit ? undefined : error);
    });
    this.prompts.register(
      this.client,
      (itemId) => this.mapper.toolDetail(itemId),
      (request) =>
        !this.hasClosed &&
        this.turnAutonomy === 'low' &&
        this.turnId !== undefined &&
        request.threadId === this.threadId &&
        request.turnId === this.turnId &&
        canApproveWorkspaceEdits(this.cwd, this.mapper.fileChanges(request.itemId)),
    );
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
    void this.interruptTurn(turnId).catch((error: unknown) => {
      if (this.turn === turn) turn?.push([this.mapper.errorEvent(error)]);
    });
  }

  // The echo of a steered message is the moment the model took it in.
  private settleDeliveredSteer(params: unknown): void {
    if (!isObject(params) || !isObject(params.item)) return;
    const { type, clientId } = params.item;
    if (type === 'userMessage' && typeof clientId === 'string') this.settleSteer(clientId, true);
  }

  private settle(turn: CodexTurn): void {
    this.prompts.cancel();
    this.dropSteers();
    if (turn.status === 'failed') this.turn?.fail(turnFailure(turn));
    else {
      // An interrupted turn settles quietly; the user asked for it.
      if (turn.status === 'completed') this.turn?.push([{ done: true }]);
      this.turn?.finish();
    }
    // The stream is over, and its generator clears these when it unwinds a
    // tick later. Letting go now is what tells a `turn/started` arriving in
    // this same batch that the turn it announces is Codex's own.
    this.turn = undefined;
    this.turnId = undefined;
  }
}

// Read the way settle() reads a typed turn.
function delegatedTurnEnd(turn: CodexTurn): DelegatedTurnEnd {
  if (turn.status === 'failed') return { status: 'failed', error: turnFailure(turn) };
  return { status: turn.status === 'completed' && !turn.error ? 'completed' : 'interrupted' };
}

function turnFailure(turn: CodexTurn): Error {
  return turn.error ?? new Error('Codex ended the turn with an error.');
}
