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
import { errMsg } from '../../errors.js';
import { hotPathMetrics } from '../../telemetry/hotPathMetrics.js';
import type { ProviderModelSettings, ProviderSession } from '../session.js';
import { UsageLimitError } from '../usageLimit.js';
import { droidErrorDetails, droidSessionNotice } from './droidErrors.js';

type DroidProcessRuntime = Pick<FactoryRuntime, 'processIdOf' | 'isProcessAlive'>;

export class DroidProviderSession implements ProviderSession {
  readonly provider = 'droid' as const;
  // The model the CLI runs as far as this session knows: the one it opened
  // on, then each one DROIDEX set, then each one Droid switched to itself.
  private modelId: string | undefined;
  private modelWritesInFlight = 0;
  // Droid's own switch this turn, held until it says why or the turn ends.
  private pendingSwitch: HarnessModelSwitch | undefined;

  constructor(
    // Primary-session events are stamped with DROIDEX's identity, not the
    // provider's: after a compaction swap the two no longer match.
    private readonly appSessionId: string,
    readonly droid: FactorySession,
    private readonly runtime: DroidProcessRuntime,
    private readonly permissions: { autonomy: Autonomy } = { autonomy: 'off' },
  ) {
    this.modelId = droid.initResult.settings.modelId;
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
    // The raw listener hears each notification before the stream yields it. A
    // switch waits until Droid says the usage limit caused it, or the turn ends.
    let limitDetail: string | undefined;
    const stopListening = this.droid.onNotification((note) => {
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
          limitDetail = notice.detail;
      }
    });
    try {
      for await (const event of this.droid.stream(prompt, { includePartialMessages: true })) {
        const pending = this.pendingSwitch;
        if (pending && (pending.cause === 'usage_limit' || event.type === 'result')) {
          yield { harnessModelSwitch: pending };
          this.pendingSwitch = undefined;
        }
        // Droid can stream the refusal as an error and still end the turn
        // with a result.
        if (event.type === 'error' && droidErrorDetails(event.message).errorKind)
          limitDetail ??= event.message;
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
      if (!droidErrorDetails(message).errorKind) throw error;
      limitDetail = message;
    } finally {
      stopListening();
      this.pendingSwitch = undefined;
    }
    // A turn refused on the limit can still end in a successful result; only
    // the notice or the streamed error says it was refused.
    if (limitDetail !== undefined) throw new UsageLimitError(limitDetail);
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

  async setAutonomy(autonomy: Autonomy): Promise<void> {
    await this.droid.updateSettings({ autonomyLevel: mapAutonomy(autonomy) });
    this.permissions.autonomy = autonomy;
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

  async interrupt(): Promise<void> {
    await this.droid.interrupt();
  }

  async close(): Promise<void> {
    await this.droid.close();
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
