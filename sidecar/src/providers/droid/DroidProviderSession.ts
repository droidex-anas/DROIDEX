import {
  factoryReasoningEffort,
  mapAutonomy,
  mapInteractionMode,
  type FactoryRuntime,
  type FactorySession,
} from '../../DroidRuntime.js';
import { normalizeStreamEvent, type NormalizedEvent } from '../../normalize.js';
import type { Autonomy, SessionInteractionMode } from '../../protocol.js';
import { hotPathMetrics } from '../../telemetry/hotPathMetrics.js';
import type { ProviderModelSettings, ProviderSession } from '../session.js';

type DroidProcessRuntime = Pick<FactoryRuntime, 'processIdOf' | 'isProcessAlive'>;

export class DroidProviderSession implements ProviderSession {
  readonly provider = 'droid' as const;

  constructor(
    // Primary-session events are stamped with DROIDEX's identity, not the
    // provider's: after a compaction swap the two no longer match.
    private readonly appSessionId: string,
    readonly droid: FactorySession,
    private readonly runtime: DroidProcessRuntime,
  ) {}

  get providerSessionId(): string {
    return this.droid.sessionId;
  }

  get process(): { pid: number; isAlive(): boolean } | undefined {
    const pid = this.runtime.processIdOf(this.droid);
    if (pid === undefined) return undefined;
    return { pid, isAlive: () => this.runtime.isProcessAlive(this.droid) };
  }

  async *stream(prompt: string): AsyncGenerator<NormalizedEvent, void, undefined> {
    for await (const event of this.droid.stream(prompt, { includePartialMessages: true })) {
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
  }

  async setAutonomy(autonomy: Autonomy): Promise<void> {
    await this.droid.updateSettings({ autonomyLevel: mapAutonomy(autonomy) });
  }

  async setModel({ modelId, reasoningEffort }: ProviderModelSettings): Promise<void> {
    // Spec-mode turns run on specModeModelId, so it stays in lockstep with the
    // chat's single visible model.
    const next = {
      ...(modelId ? { modelId, specModeModelId: modelId } : {}),
      ...(reasoningEffort !== undefined
        ? {
            reasoningEffort: factoryReasoningEffort(reasoningEffort),
            specModeReasoningEffort: factoryReasoningEffort(reasoningEffort),
          }
        : {}),
    };
    if (Object.keys(next).length > 0) await this.droid.updateSettings(next);
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
