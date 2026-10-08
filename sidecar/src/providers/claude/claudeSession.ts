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
  ProviderMention,
  ReasoningEffort,
  SessionInteractionMode,
} from '../../protocol.js';
import { errMsg } from '../../errors.js';
import { UsageLimitError } from '../usageLimit.js';
import type { SkillInfo } from '../catalog.js';
import type { ProviderInteractions } from '../interactions.js';
import type {
  DelegatedTurnEnd,
  ProviderModelSettings,
  ProviderSession,
  SteerOutcome,
  UsageMetersListener,
} from '../session.js';
import { ClaudeCatalog } from './claudeCatalog.js';
import { claudeLaunchModel, planningModelNotice, type ClaudeDefaultModel } from './claudeModels.js';
import { ClaudeEventMapper } from './claudeEvents.js';
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
import { ClaudeUsage } from './claudeRateLimits.js';

export interface ClaudeSessionInput {
  appSessionId: string;
  executable: string;
  cwd: string;
  autonomy: Autonomy;
  interactionMode: SessionInteractionMode;
  modelId?: string;
  reasoningEffort?: ReasoningEffort;
  fastMode?: boolean;
  contextWindowTokens?: ContextWindowTokens;
  // The provider's default model, so a switch back to it launches what the
  // CLI's own default would.
  defaultModel?: ClaudeDefaultModel;
  models: ModelInfo[];
  mcpServers: Record<string, McpServerConfig>;
  interactions: ProviderInteractions;
  // Set when reopening a stored session instead of starting a new one.
  resumeId?: string;
  onUsage?: UsageMetersListener;
}

// Stands in for a turn id when Stop reaches a turn Claude Code started itself.
const DELEGATED_TURN = 'delegated';

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
  readonly usage: ClaudeUsage;
  // Resolves once the CLI process exists, which is all an open has to wait for.
  private readonly spawned: Promise<void>;
  private initializing = true;
  private child?: ChildProcess;
  private fastMode: boolean;
  private readonly permissions: ClaudePermissionModes;
  private activeTurnId?: string;
  private delegatedTurnRunning = false;
  // Set when the chat stopped reading a turn the CLI is still running: what
  // the CLI says until that turn's result is the turn's own, not a new turn.
  private discardUntilResult = false;
  // The turn the user stopped, so only that turn's own error result is excused.
  private interruptedTurnId?: string;
  // The running turn takes steers: set once its prompt is pushed, never for a slash command.
  private steerable = false;
  // Steers the CLI has not started yet, by uuid, with whoever waits on each.
  private readonly steerDeliveries = new Map<
    string,
    {
      resolve: (outcome: SteerOutcome) => void;
      outcome?: SteerOutcome;
      withdrawalRequested?: true;
      cancellation?: Promise<boolean>;
    }
  >();
  // The running turn's own result has arrived; it may still wait for steers.
  private turnAnswered = false;
  private turnQueue?: MessageQueue<TurnItem>;
  // The usage refusal the provider-started turn was given, read at its result.
  private delegatedRefusal?: UsageLimitError;
  private readonly backgroundListeners = new Set<(event: NormalizedEvent) => void>();
  private readonly delegatedListeners = new Set<
    (running: boolean, end?: DelegatedTurnEnd) => void
  >();

  constructor(private readonly input: ClaudeSessionInput) {
    this.providerSessionId = input.resumeId ?? input.appSessionId;
    this.fastMode = input.fastMode ?? false;
    this.permissions = new ClaudePermissionModes(
      input.autonomy,
      input.interactionMode === 'spec',
      () => {
        this.requireOpen();
      },
      () => this.interrupt(),
      () => this.close(),
    );
    this.mapper = new ClaudeEventMapper(input.appSessionId, input.modelId, input.models);
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
        () => this.permissions.selection(),
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
    this.usage = new ClaudeUsage(this.query, () => this.waitUntilInitialized(), input.onUsage);
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

  onDelegatedTurn(listener: (running: boolean, end?: DelegatedTurnEnd) => void): () => void {
    this.delegatedListeners.add(listener);
    return () => {
      this.delegatedListeners.delete(listener);
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
    this.requireTurnCanStart();
    const turnId = randomUUID();
    this.activeTurnId = turnId;
    this.mapper.beginTurn(turnId);
    const turnQueue = (this.turnQueue = new MessageQueue<TurnItem>());
    // Read with the messages, not off the mapper: the pump maps ahead of this
    // loop, so the mapper may already hold the next turn's refusal.
    let refusal: UsageLimitError | undefined;
    let reportedPlanningModel = false;
    let ended = false;
    // A result taken off the queue means the CLI has finished the turn, even if
    // the chat stops reading before the loop gets to end it.
    let resultTaken = false;
    try {
      await this.waitUntilInitialized();
      const notice = this.permissions.takeNotice();
      if (notice) yield this.mapper.statusEvent(notice);
      await this.permissions.startTurn(() => {
        this.prompts.push({
          type: 'user',
          uuid: turnId,
          session_id: this.providerSessionId,
          parent_tool_use_id: null,
          message: { role: 'user', content: prompt },
        });
        this.steerable = !isSlashCommand(prompt);
        this.discardUntilResult = false;
      });
      for (;;) {
        const next = await turnQueue.next();
        // An exhausted stream is a failure, unless Stop closed it on a turn
        // that already had its answer.
        if (next.done) {
          if (!this.turnAnswered) throw new Error('Claude Code exited before the turn finished.');
          ended = true;
          yield { done: true };
          return;
        }
        const { message, events } = next.value;
        refusal ??= next.value.refusal;
        if (message.type === 'result') resultTaken = true;
        if (message.type === 'assistant' && !reportedPlanningModel) {
          const notice = this.permissions.planning
            ? planningModelNotice(message, this.mapper.modelId)
            : undefined;
          if (notice) {
            reportedPlanningModel = true;
            yield this.mapper.statusEvent(notice);
          }
        }
        yield* events;
        const lifecycle = commandLifecycle(message);
        if (lifecycle?.state === 'started') this.settleSteer(lifecycle.uuid, true);
        // A local slash command bypasses the model loop and publishes this one
        // terminal frame instead of a result for the ordinary turn path.
        if (message.type === 'system' && message.subtype === 'local_command_output') {
          ended = true;
          yield { done: true };
          return;
        }
        // The turn's own result, then that of each steer run as a CLI turn after it.
        if (message.type === 'result' && (this.turnAnswered || answersTurn(message, turnId))) {
          const refused = refusal;
          refusal = undefined;
          if (refused) throw refused;
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
          ended = true;
          yield { done: true };
          return;
        }
      }
    } catch (error) {
      // A turn that fails has ended as surely as one that answered. Only a chat
      // that stopped reading leaves the CLI still running it.
      ended = true;
      throw error;
    } finally {
      this.activeTurnId = undefined;
      this.steerable = false;
      this.turnAnswered = false;
      if (this.turnQueue === turnQueue) this.turnQueue = undefined;
      const unread = turnQueue.drain();
      // What the pump read after this turn ended, before the turn was handed
      // over, is a turn Claude Code started itself. It goes on only now that the
      // chat has closed this one, or closing this one would cut it off. A turn
      // the chat stopped reading before its end is still the CLI's: the rest of
      // it, up to its result, is dropped as it was.
      if (ended || resultTaken) this.continueAfterTurn(unread);
      else {
        // The rest of the stopped turn ends at its result; what follows that
        // is a turn Claude Code started itself.
        const result = unread.findIndex(({ message }) => message.type === 'result');
        this.discardUntilResult = result < 0;
        if (result >= 0) this.continueAfterTurn(unread.slice(result + 1));
      }
      await Promise.all(
        [...this.steerDeliveries.keys()].map((uuid) => this.cancelUndeliveredSteer(uuid)),
      );
    }
  }

  // Hands the prompt to the running turn: the CLI folds it in at the next tool
  // boundary, or runs it right after the turn's result. Resolves true once the
  // model has it. The CLI resolves a slash command itself, so that can only
  // run as a turn of its own.
  steer(
    text: string,
    _mentions: ProviderMention[] | undefined,
    uuid: string,
  ): Promise<SteerOutcome> {
    if (!this.steerable || this.isClosed || isSlashCommand(text)) return Promise.resolve(false);
    const delivery = new Promise<SteerOutcome>((resolve) => {
      this.steerDeliveries.set(uuid, { resolve });
    });
    this.prompts.push({
      type: 'user',
      uuid: uuid as SDKUserMessage['uuid'],
      session_id: this.providerSessionId,
      parent_tool_use_id: null,
      message: { role: 'user', content: text },
      priority: 'next',
    });
    return delivery;
  }

  private settleSteer(uuid: string, outcome: SteerOutcome): void {
    const pending = this.steerDeliveries.get(uuid);
    if (!pending) return;
    this.steerDeliveries.delete(uuid);
    pending.outcome = outcome;
    pending.resolve(outcome);
  }

  private settleCancelledSteer(uuid: string): void {
    this.settleSteer(
      uuid,
      this.steerDeliveries.get(uuid)?.withdrawalRequested ? 'withdrawn' : false,
    );
  }

  async withdrawSteer(uuid: string): Promise<boolean> {
    const pending = this.steerDeliveries.get(uuid);
    if (!pending || this.isClosed) return false;
    pending.withdrawalRequested = true;
    // Re-asks and turn finalization share the same cancellation receipt.
    pending.cancellation ??= this.query.cancelAsyncMessage(uuid).catch(() => false);
    const cancelled = await pending.cancellation;
    delete pending.cancellation;
    // A failed withdrawal must not claim a later Stop or Send now cancellation.
    if (!cancelled) delete pending.withdrawalRequested;
    if (this.abort.signal.aborted) return pending.outcome === 'withdrawn';
    if (cancelled) this.settleCancelledSteer(uuid);
    return pending.outcome === 'withdrawn';
  }

  // A steer the turn ended without is withdrawn so the session layer can send
  // it again. Unless the CLI says it cancelled it, the CLI may still run it,
  // and losing one steer on a failed turn beats showing it twice.
  private async cancelUndeliveredSteer(uuid: string): Promise<void> {
    const pending = this.steerDeliveries.get(uuid);
    if (!pending) return;
    if (this.isClosed) {
      this.settleSteer(uuid, false);
      return;
    }
    // Finalization and user withdrawal must settle from the same cancellation receipt.
    pending.cancellation ??= this.query.cancelAsyncMessage(uuid).catch(() => false);
    const cancelled = await pending.cancellation;
    delete pending.cancellation;
    if (cancelled) this.settleCancelledSteer(uuid);
    else this.settleSteer(uuid, 'unconfirmed');
  }

  private requireTurnCanStart(): void {
    if (this.activeTurnId) throw new Error('This Claude session is already running a turn.');
    if (this.delegatedTurnRunning)
      throw new Error('This Claude session is finishing a turn it started itself.');
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
    this.usage.observe(message);
    // Cancellation can confirm a withdrawal while the turn reader is busy.
    const lifecycle = commandLifecycle(message);
    if (lifecycle?.state === 'cancelled') this.settleCancelledSteer(lifecycle.uuid);
    if (
      !this.activeTurnId &&
      !this.delegatedTurnRunning &&
      !this.discardUntilResult &&
      startsDelegatedTurn(message)
    ) {
      // No prompt of ours opened this turn, so its answer has no fork point.
      this.mapper.beginTurn(undefined);
      this.setDelegatedTurn(true);
    }
    // Mapping stays in wire order, including model and spawn-link observations.
    const events = this.mapper.map(message, this.fastMode);
    const refusal = this.mapper.takeRefusal();
    if (this.delegatedTurnRunning) {
      this.forwardDelegated({ message, events, refusal });
      return;
    }
    if (this.discardUntilResult && message.type === 'result') this.discardUntilResult = false;
    const turnEvents: NormalizedEvent[] = [];
    for (const event of events) {
      if (event.childSession) {
        for (const listener of this.backgroundListeners) listener(event);
      } else turnEvents.push(event);
    }
    this.turnQueue?.push({ message, events: turnEvents, refusal });
  }

  private continueAfterTurn(items: TurnItem[]): void {
    for (const { message, events, refusal } of items) {
      if (!this.delegatedTurnRunning && startsDelegatedTurn(message)) {
        // Already mapped, spawns included: only the fork point is dropped.
        this.mapper.forgetForkPoint();
        this.setDelegatedTurn(true);
      }
      // Mapped while our turn was current, so they carry its fork point.
      if (this.delegatedTurnRunning)
        this.forwardDelegated({ message, events: events.map(withoutForkPoint), refusal });
    }
  }

  // A turn Claude Code started itself reaches the chat as it happens.
  private forwardDelegated({ message, events, refusal }: TurnItem): void {
    for (const event of events) for (const listener of this.backgroundListeners) listener(event);
    this.delegatedRefusal ??= refusal;
    if (message.type !== 'result') return;
    // A usage refusal still ends the turn with a result, as a typed turn's does.
    const refused = this.delegatedRefusal;
    this.delegatedRefusal = undefined;
    if (refused) this.endDelegatedTurn(refused);
    else if (message.subtype !== 'success')
      this.endDelegatedTurn(new Error(turnFailure(message.subtype, message.errors)), true);
    else if (message.is_error) this.endDelegatedTurn(new Error(message.result), true);
    else this.endDelegatedTurn();
  }

  // A stopped turn settles quietly, as a typed one does, however it ended.
  private endDelegatedTurn(error?: Error, showError = false): void {
    const stopped = this.interruptedTurnId === DELEGATED_TURN;
    if (stopped) this.interruptedTurnId = undefined;
    // A refusal holds the chat however the turn ended, as a typed turn's does.
    if (stopped && !(error instanceof UsageLimitError)) {
      this.setDelegatedTurn(false, { status: 'interrupted' });
      return;
    }
    if (error && showError)
      for (const listener of this.backgroundListeners)
        listener(this.mapper.errorEvent(error.message));
    this.setDelegatedTurn(false, error ? { status: 'failed', error } : { status: 'completed' });
  }

  private setDelegatedTurn(running: boolean, end?: DelegatedTurnEnd): void {
    if (this.delegatedTurnRunning === running) return;
    this.delegatedTurnRunning = running;
    if (running) this.delegatedRefusal = undefined;
    for (const listener of this.delegatedListeners) listener(running, end);
  }

  async setAutonomy(autonomy: Autonomy): Promise<void> {
    await this.permissions.change(this.initialized, { autonomy });
    this.publishPermissionNotice();
  }

  async setInteractionMode(mode: SessionInteractionMode): Promise<void> {
    await this.permissions.change(this.initialized, { planning: mode === 'spec' });
    this.publishPermissionNotice();
  }

  get autonomy(): Autonomy {
    return this.permissions.selection();
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
      modelId === undefined ? this.mapper.modelId : (modelId ?? undefined),
      contextWindowTokens ?? this.input.contextWindowTokens,
      this.input.models,
      this.input.defaultModel,
    );
    if (modelId !== undefined && resolvedModel !== this.mapper.modelId) {
      await this.query.setModel(resolvedModel);
      this.requireOpen();
      this.mapper.setModel(resolvedModel);
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
    if (!turnId && !this.delegatedTurnRunning) return;
    const interruptedId = turnId ?? DELEGATED_TURN;
    // A second Stop during boot releases a CLI that never initializes.
    if (this.initializing && this.interruptedTurnId === interruptedId) {
      await this.close();
      return;
    }
    this.interruptedTurnId = interruptedId;
    try {
      await this.initialized;
    } catch {
      // The turn or closure observer owns startup failure diagnostics.
      return;
    }
    if (
      this.abort.signal.aborted ||
      (turnId ? this.activeTurnId !== turnId : !this.delegatedTurnRunning)
    )
      return;
    // Aborts the in-flight turn on the live process; the turn then settles with
    // its own result, so the next prompt does not pay for a restart. Steers not
    // yet delivered are cancelled with it rather than left to run unobserved.
    const receipt = await this.query.interrupt({ cancelQueued: true });
    for (const uuid of receipt?.cancelled ?? []) this.settleCancelledSteer(uuid);
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
    this.delegatedListeners.clear();
    // The SDK closes stdin and escalates SIGTERM to SIGKILL itself.
    try {
      this.query.close();
    } finally {
      this.resolveClosed(error);
    }
  }
}
// Claude Code continues on its own when a background task it started finishes
// after the turn ended: a task notification and a fresh init, then the model's
// reply and a result, with no prompt of ours behind them (measured on the CLI).
// The model's first output is where that turn starts for DROIDEX.
// A usage refusal is such an assistant message too, so it opens the turn it ends.
function startsDelegatedTurn(message: SDKMessage): boolean {
  return (
    (message.type === 'assistant' || message.type === 'stream_event') &&
    message.parent_tool_use_id === null
  );
}

interface TurnItem {
  message: SDKMessage;
  events: NormalizedEvent[];
  refusal?: UsageLimitError | undefined;
}

function withoutForkPoint(event: NormalizedEvent): NormalizedEvent {
  return event.transcript
    ? { ...event, transcript: { ...event.transcript, forkPointId: undefined } }
    : event;
}
