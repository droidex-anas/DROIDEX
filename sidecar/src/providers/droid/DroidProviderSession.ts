import {
  factoryReasoningEffort,
  mapAutonomy,
  mapInteractionMode,
  type FactoryRuntime,
  type FactorySession,
} from '../../DroidRuntime.js';
import {
  extractNotification,
  normalizeStreamEvent,
  type HarnessModelSwitch,
  type NormalizedEvent,
} from '../../normalize.js';
import type { Autonomy, ReasoningEffort, SessionInteractionMode } from '../../protocol.js';
import { normalizeAutonomy } from '../../values.js';
import { SessionAutonomy } from '../sessionAutonomy.js';
import { errMsg } from '../../errors.js';
import { hotPathMetrics } from '../../telemetry/hotPathMetrics.js';
import type { ProviderMention } from '../catalog.js';
import type { ProviderModelSettings, ProviderSession, SteerOutcome } from '../session.js';
import { UsageLimitError } from '../usageLimit.js';
import { droidErrorDetails, droidSessionNotice } from './droidErrors.js';
import { factoryRefusalLimit, readFactoryUsage } from './factoryUsage.js';

type DroidProcessRuntime = Pick<
  FactoryRuntime,
  | 'processIdOf'
  | 'isProcessAlive'
  | 'factoryApiKey'
  | 'steer'
  | 'streamTurn'
  | 'observeNotification'
  | 'interruptTurn'
  | 'stopTurn'
>;

// The turn settles only once the billing read behind its refusal has answered.
const REFUSAL_READ_TIMEOUT_MS = 10_000;
const AUTONOMY_LEVELS: readonly Autonomy[] = ['off', 'low', 'medium', 'high'];
const NATIVE_AUTONOMY_LEVELS = AUTONOMY_LEVELS.map(mapAutonomy);

export class DroidProviderSession implements ProviderSession {
  readonly provider = 'droid' as const;
  // The model the CLI runs as far as this session knows: the one it opened
  // on, then each one DROIDEX set, then each one Droid switched to itself.
  private modelId: string | undefined;
  private modelWritesInFlight = 0;
  // Droid's own switch, held until it says why or a turn reaches its result.
  private pendingSwitch: HarnessModelSwitch | undefined;
  // The refusal Droid gave this turn, if any.
  private limitDetail: string | undefined;
  private readonly stopListening: () => void;
  private readonly permissions: SessionAutonomy;
  private retired = false;
  private closePromise?: Promise<void>;
  private resolveClosed: () => void = () => undefined;
  readonly closed = new Promise<Error | undefined>((resolve) => {
    this.resolveClosed = () => {
      resolve(undefined);
    };
  });
  private nativeAutonomy: FactorySession['initResult']['settings']['autonomyLevel'];

  constructor(
    // Primary-session events are stamped with DROIDEX's identity, not the
    // provider's: after a compaction swap the two no longer match.
    private readonly appSessionId: string,
    readonly droid: FactorySession,
    private readonly runtime: DroidProcessRuntime,
    autonomy: Autonomy = 'off',
  ) {
    this.nativeAutonomy = droid.initResult.settings.autonomyLevel;
    this.permissions = new SessionAutonomy(autonomy, {
      write: async () => {
        const level = this.permissions.latestAutonomy;
        await this.droid.updateSettings({ autonomyLevel: mapAutonomy(level) });
        this.permissions.requireOpen();
        this.nativeAutonomy = mapAutonomy(level);
        return level;
      },
      isApplied: () => this.nativeAutonomy === mapAutonomy(this.permissions.latestAutonomy),
      isUnsafe: () =>
        this.nativeAutonomy === undefined ||
        NATIVE_AUTONOMY_LEVELS.indexOf(this.nativeAutonomy) >
          NATIVE_AUTONOMY_LEVELS.indexOf(mapAutonomy(this.permissions.latestAutonomy)),
      interrupt: () => this.interrupt(),
      close: async () => {
        // Ordinary closes belong to lifecycle or compaction; forced retirement
        // must also notify lifecycle so it releases this dead runtime.
        this.retired = true;
        const closing = this.close();
        this.resolveClosed();
        await closing;
      },
      requireOpen: () => {
        if (this.retired) throw new Error('This Droid session is closed.');
      },
    });
    if (this.nativeAutonomy !== mapAutonomy(autonomy))
      this.permissions.confirm(normalizeAutonomy(this.nativeAutonomy) ?? 'off');
    this.modelId = droid.initResult.settings.modelId;
    // Listened to for the session's life: a switch Droid reports between turns
    // is still the model the next turn runs on.
    this.stopListening = droid.onNotification((note) => {
      this.runtime.observeNotification(droid, note);
      const notice = droidSessionNotice(extractNotification(note));
      switch (notice?.kind) {
        case 'model': {
          const next = this.observeModel(notice.modelId, notice.reasoningEffort);
          if (next)
            this.pendingSwitch = this.pendingSwitch
              ? { ...next, from: this.pendingSwitch.from }
              : next;
          return;
        }
        case 'core_fallback':
          if (this.pendingSwitch) this.pendingSwitch.cause = 'usage_limit';
          return;
        case 'usage_limit':
          this.limitDetail = notice.detail;
      }
    });
  }

  get providerSessionId(): string {
    return this.droid.sessionId;
  }

  get process(): { pid: number; isAlive(): boolean } | undefined {
    const pid = this.runtime.processIdOf(this.droid);
    if (pid === undefined) return undefined;
    return { pid, isAlive: () => this.runtime.isProcessAlive(this.droid) };
  }

  async *stream(prompt: string): AsyncGenerator<NormalizedEvent, void, undefined> {
    while (!this.permissions.isApplied) await this.permissions.synchronize();
    this.permissions.requireOpen();
    // The raw listener hears each notification before the stream yields it. A
    // switch waits until Droid says the usage limit caused it, or a turn reaches
    // its result; one not yet reported when a turn fails goes with the next.
    this.limitDetail = undefined;
    try {
      for await (const event of this.runtime.streamTurn(this.droid, prompt, {
        includePartialMessages: true,
      })) {
        const pending = this.pendingSwitch;
        if (pending && (pending.cause === 'usage_limit' || event.type === 'result')) {
          yield { harnessModelSwitch: pending };
          this.pendingSwitch = undefined;
        }
        // Droid can stream the refusal as an error and still end the turn
        // with a result.
        if (event.type === 'error' && droidErrorDetails(event.message).errorKind)
          this.limitDetail ??= event.message;
        const normalizeStartedAt = performance.now();
        const normalized = normalizeStreamEvent(
          this.appSessionId,
          this.appSessionId,
          'primary',
          event,
        );
        hotPathMetrics.recordNormalize(performance.now() - normalizeStartedAt);
        if (normalized) yield normalized;
      }
    } catch (error) {
      const message = errMsg(error);
      // A limit notice already proved the refusal; a later error does not undo it.
      if (!droidErrorDetails(message).errorKind && this.limitDetail === undefined) throw error;
      this.limitDetail ??= message;
    }
    // A turn refused on the limit can still end in a successful result; only
    // the notice or the streamed error says it was refused.
    if (this.limitDetail !== undefined) throw await this.usageLimitError(this.limitDetail);
  }

  // Droid's refusal names no reset. With a Factory key, one billing read says
  // when the spent window resets and whether the other pool has room; without
  // a key, or when that read fails, the refusal stands as Droid worded it.
  private async usageLimitError(message: string): Promise<UsageLimitError> {
    const apiKey = this.runtime.factoryApiKey();
    if (!apiKey) return new UsageLimitError(message);
    try {
      const { meters } = await readFactoryUsage(
        apiKey,
        AbortSignal.timeout(REFUSAL_READ_TIMEOUT_MS),
      );
      return new UsageLimitError(message, factoryRefusalLimit(meters, Date.now()));
    } catch {
      return new UsageLimitError(message);
    }
  }

  // A settings echo naming another model is Droid's own switch, unless a model
  // write of ours is in flight: its echo, or a switch crossing it, cannot be
  // told apart, and the write decides the model either way.
  private observeModel(
    modelId: string,
    reasoningEffort: ReasoningEffort | undefined,
  ): HarnessModelSwitch | undefined {
    const from = this.modelId;
    if (this.modelWritesInFlight > 0 || modelId === from) return undefined;
    this.modelId = modelId;
    if (!from) return undefined;
    return { from, to: modelId, cause: 'harness', ...(reasoningEffort ? { reasoningEffort } : {}) };
  }

  setAutonomy(autonomy: Autonomy): Promise<void> {
    return this.permissions.set(autonomy);
  }

  get autonomy(): Autonomy {
    return this.permissions.selection;
  }

  get isClosed(): boolean {
    return this.retired;
  }

  async setModel({ modelId, reasoningEffort }: ProviderModelSettings): Promise<void> {
    // Spec-mode turns run on specModeModelId, so it stays in lockstep with the
    // chat's single visible model.
    // Every Droid model publishes its levels, so a cleared effort never
    // arrives here in practice; Droid keeps its own when it does.
    const next = {
      ...(modelId ? { modelId, specModeModelId: modelId } : {}),
      ...(reasoningEffort
        ? {
            reasoningEffort: factoryReasoningEffort(reasoningEffort),
            specModeReasoningEffort: factoryReasoningEffort(reasoningEffort),
          }
        : {}),
    };
    if (Object.keys(next).length === 0) return;
    if (!modelId) {
      await this.droid.updateSettings(next);
      // A switch still to be reported must not carry back the effort replaced here.
      if (this.pendingSwitch && reasoningEffort)
        this.pendingSwitch.reasoningEffort = reasoningEffort;
      return;
    }
    // The user's pick replaces any switch Droid made before it, unless the
    // pick is refused.
    const previous = { modelId: this.modelId, pendingSwitch: this.pendingSwitch };
    this.modelId = modelId;
    this.pendingSwitch = undefined;
    this.modelWritesInFlight += 1;
    try {
      await this.droid.updateSettings(next);
    } catch (error) {
      ({ modelId: this.modelId, pendingSwitch: this.pendingSwitch } = previous);
      throw error;
    } finally {
      this.modelWritesInFlight -= 1;
    }
  }

  // Spec has an entry point of its own; the daemon takes the other modes as a
  // plain setting.
  async setInteractionMode(mode: SessionInteractionMode): Promise<void> {
    if (mode === 'spec') {
      await this.droid.enterSpecMode();
      return;
    }
    await this.droid.updateSettings({ interactionMode: mapInteractionMode(mode) });
  }

  interrupt(): Promise<void> {
    return this.runtime.interruptTurn(this.droid);
  }

  steer(
    text: string,
    _mentions: ProviderMention[] | undefined,
    steerId: string,
  ): Promise<SteerOutcome> {
    return this.runtime.steer(this.droid, text, steerId);
  }

  close(): Promise<void> {
    if (this.closePromise) return this.closePromise;
    this.permissions.stop();
    this.runtime.stopTurn(this.droid);
    this.stopListening();
    this.closePromise = this.droid.close().catch((error: unknown) => {
      this.closePromise = undefined;
      throw error;
    });
    return this.closePromise;
  }
}

// The Droid-only parts of the session layer (context stats, compaction, spec
// mode, rewind, child sessions) drive the SDK session directly. A session on
// another provider has none, which is what makes those features Droid-only.
export function droidSessionOf(session: ProviderSession): FactorySession | undefined {
  return session instanceof DroidProviderSession ? session.droid : undefined;
}

export function requireDroidSession(session: ProviderSession): FactorySession {
  const droid = droidSessionOf(session);
  if (!droid) {
    throw new Error(`This is not supported for sessions on the ${session.provider} provider.`);
  }
  return droid;
}
