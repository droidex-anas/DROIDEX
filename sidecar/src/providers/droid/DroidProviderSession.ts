import type { FactoryRuntime, FactorySession } from '../../DroidRuntime.js';
import { normalizeStreamEvent, type NormalizedEvent } from '../../normalize.js';
import { hotPathMetrics } from '../../telemetry/hotPathMetrics.js';
import type { ProviderSession } from '../session.js';

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

  async interrupt(): Promise<void> {
    await this.droid.interrupt();
  }

  async close(): Promise<void> {
    await this.droid.close();
  }
}

// The Droid-only parts of the session layer (context stats, compaction, spec
// mode, rewind, child sessions) still drive the SDK session directly, so a live
// session keeps the one behind its provider session. Droid is the only provider
// this build can open, which is what makes that binding total.
export function requireDroidSession(session: ProviderSession): FactorySession {
  if (!(session instanceof DroidProviderSession)) {
    throw new Error(`Sessions on the ${session.provider} provider are not available yet.`);
  }
  return session.droid;
}
