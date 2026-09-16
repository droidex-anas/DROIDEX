import type { ProviderStatus } from '../protocol.js';
import type { ProviderKind } from './providerKind.js';

export type ProviderProbeMap = ReadonlyMap<
  ProviderKind,
  (signal: AbortSignal) => Promise<ProviderStatus>
>;

// A harness that pins $HOME to a temp directory probes nothing: a real probe
// starts the provider's CLI, which writes under that directory and keeps
// writing after the harness has removed it.
export const NO_PROVIDER_PROBES: ProviderProbeMap = new Map();

// Claude Code's and Codex's readiness each cost a CLI process to learn, so they
// are probed on demand and remembered: provider status can then be emitted on
// any event without spawning anything. One round of probes runs at a time; a
// refresh that arrives while one is in flight joins it instead of starting more.
export class ProviderProbes {
  private readonly latest = new Map<ProviderKind, ProviderStatus>();
  private inFlight?: Promise<void>;
  private abort?: AbortController;

  constructor(private readonly probes: ProviderProbeMap) {}

  // The last answer, or undefined while a provider has not been probed yet —
  // which the picker reads as "still checking".
  status(provider: ProviderKind): ProviderStatus | undefined {
    return this.latest.get(provider);
  }

  refresh(): Promise<void> {
    if (this.inFlight) return this.inFlight;
    const abort = new AbortController();
    this.abort = abort;
    // Settled, not all: a provider whose probe rejects must not end the round
    // for its siblings or clear `inFlight` while they are still running.
    const round = Promise.allSettled(
      [...this.probes].map(async ([provider, probe]) => {
        this.latest.set(provider, await probe(abort.signal));
      }),
    )
      .then(() => undefined)
      .finally(() => {
        if (this.inFlight === round) this.inFlight = undefined;
        if (this.abort === abort) this.abort = undefined;
      });
    this.inFlight = round;
    return round;
  }

  // Shutdown: a probe still waiting on a CLI must not hold the process open.
  cancel(): void {
    this.abort?.abort();
  }
}
