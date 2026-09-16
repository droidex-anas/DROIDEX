import type { ProviderStatus, SkillInfo } from '../protocol.js';
import type { ProviderKind } from './providerKind.js';

// Readiness comes back as soon as the CLI answers. A catalog that takes longer
// follows through `publishItems` from the same process, each call carrying
// every row known so far.
export type ProviderProbe = (
  signal: AbortSignal,
  publishItems: (items: SkillInfo[]) => void,
) => Promise<ProviderStatus>;
export type ProviderProbeMap = ReadonlyMap<ProviderKind, ProviderProbe>;

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
  // The live round's controller, kept past its answers: a probe's catalog can
  // still be streaming from its process, and shutdown has to reach it.
  private abort?: AbortController;
  private generation = 0;

  constructor(
    private readonly probes: ProviderProbeMap,
    // Called when rows arrive for a status already handed out.
    private readonly onItems: (provider: ProviderKind) => void = () => undefined,
  ) {}

  // The last answer, or undefined while a provider has not been probed yet —
  // which the picker reads as "still checking".
  status(provider: ProviderKind): ProviderStatus | undefined {
    return this.latest.get(provider);
  }

  refresh(): Promise<void> {
    if (this.inFlight) return this.inFlight;
    // A new round supersedes whatever the last one is still streaming.
    this.cancel();
    const abort = new AbortController();
    this.abort = abort;
    const generation = ++this.generation;
    // Settled, not all: a provider whose probe rejects must not end the round
    // for its siblings or clear `inFlight` while they are still running.
    const round = Promise.allSettled(
      [...this.probes].map(async ([provider, probe]) => {
        let status: ProviderStatus | undefined;
        let items: SkillInfo[] | undefined;
        const publishItems = (rows: SkillInfo[]): void => {
          if (generation !== this.generation) return;
          items = rows;
          // Rows that beat the status ride on it when it lands.
          if (!status) return;
          status = { ...status, items: rows };
          this.latest.set(provider, status);
          this.onItems(provider);
        };
        const answered = await probe(abort.signal, publishItems);
        status = items ? { ...answered, items } : answered;
        this.latest.set(provider, status);
      }),
    )
      .then(() => undefined)
      .finally(() => {
        if (this.inFlight === round) this.inFlight = undefined;
      });
    this.inFlight = round;
    return round;
  }

  // Shutdown: a probe still waiting on a CLI, or still streaming its catalog,
  // must not hold the process open.
  cancel(): void {
    this.abort?.abort();
    this.abort = undefined;
  }
}
