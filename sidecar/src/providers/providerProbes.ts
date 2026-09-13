import type { ProviderStatus } from '../protocol.js';

// Claude Code's readiness costs a CLI process to learn, so it is probed on
// demand and remembered: provider status can then be emitted on any event
// without spawning anything. One probe runs at a time; a refresh that arrives
// while one is in flight joins it instead of starting a second CLI.
export class ProviderProbes {
  private latestClaude?: ProviderStatus;
  private inFlight?: Promise<ProviderStatus>;
  private abort?: AbortController;

  constructor(private readonly probeClaude: (signal: AbortSignal) => Promise<ProviderStatus>) {}

  // The last answer, or undefined while nothing has been probed yet — which the
  // picker reads as "still checking".
  get claude(): ProviderStatus | undefined {
    return this.latestClaude;
  }

  refresh(): Promise<ProviderStatus> {
    if (this.inFlight) return this.inFlight;
    const abort = new AbortController();
    this.abort = abort;
    const probe = this.probeClaude(abort.signal)
      .then((status) => {
        this.latestClaude = status;
        return status;
      })
      .finally(() => {
        if (this.inFlight === probe) this.inFlight = undefined;
        if (this.abort === abort) this.abort = undefined;
      });
    this.inFlight = probe;
    return probe;
  }

  // Shutdown: a probe still waiting on a CLI must not hold the process open.
  cancel(): void {
    this.abort?.abort();
  }
}
