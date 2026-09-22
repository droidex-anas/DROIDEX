// Selecting a chat is the earliest honest sign that the user is about to write
// in it. Starting its provider runtime then, instead of when they press enter,
// is the difference between a send that answers straight away and one that
// waits seconds for a CLI to boot: the runtime the idle sweep released, or one
// never opened since the app started, comes back while the user is still
// typing. A warm-up starts no turn and writes no transcript row.

// How long a selection has to hold before it is worth a process. Arrowing down
// the sidebar passes over chats the user is not opening, and each runtime is
// hundreds of megabytes.
const SELECTION_SETTLED_MS = 250;

export interface SessionRuntimeWarmUpDependencies {
  // Resolves once the sidecar knows which stored sessions exist, so a selection
  // made before then is warmed against a real summary rather than guessed at.
  ready: () => Promise<void>;
  // False for a session this build cannot reopen: no stored summary, or one
  // bound to a provider that is not routable here.
  isResumable: (appSessionId: string) => boolean;
  isLive: (appSessionId: string) => boolean;
  resume: (appSessionId: string) => Promise<unknown>;
}

export class SessionRuntimeWarmUp {
  private pending?: { appSessionId: string; timer: ReturnType<typeof setTimeout> };
  // What is on screen right now. A warm-up that had to wait behind one still
  // resuming checks this when its turn comes, so a chat the user has since
  // left is skipped; one whose turn came at once proceeds as selected.
  private selectedId: string | null = null;
  private inFlight?: Promise<void>;
  private stopped = false;

  constructor(private readonly dependencies: SessionRuntimeWarmUpDependencies) {}

  // What the renderer now says is on screen. A selection that has not yet cost
  // anything is dropped when the user moves on; one already resuming is left to
  // finish, because a prompt may have joined it by then and the idle sweep
  // releases it soon enough either way.
  selected(appSessionId: string | null): void {
    clearTimeout(this.pending?.timer);
    this.pending = undefined;
    this.selectedId = appSessionId;
    if (this.stopped || appSessionId === null) return;
    const timer = setTimeout(() => {
      this.pending = undefined;
      void this.warm(appSessionId);
    }, SELECTION_SETTLED_MS);
    timer.unref();
    this.pending = { appSessionId, timer };
  }

  // Runs the selection's warm-up now rather than when its delay expires, and
  // resolves once the runtime is up. The retirement sweep is driven the same
  // way, so nothing has to race either timer.
  flush(): Promise<void> {
    const pending = this.pending;
    if (pending) {
      clearTimeout(pending.timer);
      this.pending = undefined;
      return this.warm(pending.appSessionId);
    }
    return this.inFlight ?? Promise.resolve();
  }

  stop(): void {
    this.stopped = true;
    clearTimeout(this.pending?.timer);
    this.pending = undefined;
  }

  // One warm-up at a time: a second selection waits behind the first rather
  // than opening two runtimes at once.
  private warm(appSessionId: string): Promise<void> {
    const queued = this.inFlight !== undefined;
    const run = (this.inFlight ?? Promise.resolve())
      .then(() => this.resumeIfWorthwhile(appSessionId, queued))
      .finally(() => {
        if (this.inFlight === run) this.inFlight = undefined;
      });
    this.inFlight = run;
    return run;
  }

  private async resumeIfWorthwhile(appSessionId: string, queued: boolean): Promise<void> {
    const d = this.dependencies;
    await d.ready();
    if (this.stopped || (queued && this.selectedId !== appSessionId)) return;
    if (d.isLive(appSessionId) || !d.isResumable(appSessionId)) return;
    await d.resume(appSessionId);
  }
}
