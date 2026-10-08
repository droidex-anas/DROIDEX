import type { CanvasCommitOwner } from './canvas/canvasCommits.js';

const CLOSE_DIAGNOSTIC_DELAY_MS = 5_000;

/** One create generation owns first turns, provider changes and started writes. */
export class SessionCreateAdmission implements CanvasCommitOwner {
  private cancelled = false;
  private admitted = false;
  private delegatedRevision = 0;
  private readonly cancellation = new AbortController();
  readonly signal = this.cancellation.signal;
  private settle: (admitted: boolean) => void = () => undefined;
  readonly ready = new Promise<boolean>((resolve) => {
    this.settle = resolve;
  });
  private commitFinished?: Promise<void>;

  constructor(private readonly ownsRuntime: () => boolean) {}

  readonly isCurrent = (): boolean => !this.cancelled && this.ownsRuntime();

  readonly requireCurrent = (): void => {
    if (!this.isCurrent()) throw new Error('The session closed before its first turn.');
  };

  admit(): void {
    this.requireCurrent();
    this.admitted = true;
    this.settle(true);
  }

  cancel(): void {
    this.cancelled = true;
    this.cancellation.abort();
    this.settle(false);
  }

  canChangeProvider(): boolean {
    return this.admitted && this.isCurrent();
  }

  requireProviderChange(): void {
    if (!this.canChangeProvider())
      throw new Error('This chat is still opening. Wait for it to finish before compacting.');
  }

  async deferDelegatedTurn(running: boolean, apply: (running: boolean) => void): Promise<void> {
    const revision = ++this.delegatedRevision;
    if (!this.admitted && !(await this.ready)) return;
    if (revision !== this.delegatedRevision || !this.isCurrent()) return;
    apply(running);
  }

  async commit<T>(operation: () => Promise<T>): Promise<T> {
    this.requireCurrent();
    const pending = operation();
    const finished = pending.then(
      () => undefined,
      () => undefined,
    );
    this.commitFinished = finished;
    void finished.then(() => {
      if (this.commitFinished === finished) this.commitFinished = undefined;
    });
    const result = await pending;
    this.requireCurrent();
    return result;
  }

  // A started commit must settle before a replacement can own the chat.
  async drain(onWaiting: () => void): Promise<void> {
    if (!this.commitFinished) return;
    const diagnostic = setTimeout(onWaiting, CLOSE_DIAGNOSTIC_DELAY_MS);
    diagnostic.unref();
    try {
      await this.commitFinished;
    } finally {
      clearTimeout(diagnostic);
    }
  }
}
