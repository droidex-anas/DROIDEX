// Kit captures held within character and entry budgets. Past either budget,
// captures no consumer holds are let go, least recently held first; one a
// consumer holds stays, since letting it go would blank a tile on screen.

const READ_FAILED = Symbol('read failed');

export class KitCaptureCache {
  /** Least recently held first; failed reads display like absence but remain retryable. */
  private readonly urls = new Map<string, string | null | typeof READ_FAILED>();
  private readonly holds = new Map<string, number>();
  private retained = 0;

  constructor(
    private readonly budgetChars: number,
    private readonly maxEntries = 1024,
  ) {}

  get retainedChars(): number {
    return this.retained;
  }

  /** The URL, null on absence or read failure, undefined when it is not here. */
  get(key: string): string | null | undefined {
    const url = this.urls.get(key);
    return url === READ_FAILED ? null : url;
  }

  has(key: string): boolean {
    return this.urls.has(key);
  }

  needsRead(key: string): boolean {
    const url = this.urls.get(key);
    return url === undefined || url === READ_FAILED;
  }

  /** Whether a consumer still holds `key`. */
  isHeld(key: string): boolean {
    return this.holds.has(key);
  }

  set(key: string, url: string | null): void {
    this.forget(key);
    this.urls.set(key, url);
    this.retained += url?.length ?? 0;
    this.trim();
  }

  fail(key: string): void {
    this.forget(key);
    this.urls.set(key, READ_FAILED);
    this.trim();
  }

  /** Counts a consumer of `key` and makes it the most recently held; call the result once to let go. */
  hold(key: string): () => void {
    this.holds.set(key, (this.holds.get(key) ?? 0) + 1);
    const url = this.urls.get(key);
    if (url !== undefined) {
      this.urls.delete(key);
      this.urls.set(key, url);
    }
    let isHeld = true;
    return () => {
      if (!isHeld) return;
      isHeld = false;
      const count = this.holds.get(key) ?? 1;
      if (count === 1) this.holds.delete(key);
      else this.holds.set(key, count - 1);
      // After the current commit, so a consumer that mounts again at once (as
      // StrictMode replays effects) keeps its capture.
      queueMicrotask(() => {
        this.trim();
      });
    };
  }

  private trim(): void {
    for (const [key] of this.urls) {
      if (this.retained <= this.budgetChars && this.urls.size <= this.maxEntries) return;
      if (!this.holds.has(key)) this.forget(key);
    }
  }

  private forget(key: string): void {
    const url = this.urls.get(key);
    this.retained -= typeof url === 'string' ? url.length : 0;
    this.urls.delete(key);
  }
}
