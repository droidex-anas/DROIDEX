// Kit captures held in memory within a budget of data URL characters. Past
// it, captures no consumer holds are let go, least recently held first; one a
// consumer holds stays, since letting it go would blank a tile on screen.

export class KitCaptureCache {
  /** A data URL per key, or null once its read found none; least recently held first. */
  private readonly urls = new Map<string, string | null>();
  private readonly holds = new Map<string, number>();
  private retained = 0;

  constructor(private readonly budgetChars: number) {}

  get retainedChars(): number {
    return this.retained;
  }

  /** The capture's URL, null when there is none, undefined when it is not here. */
  get(key: string): string | null | undefined {
    return this.urls.get(key);
  }

  has(key: string): boolean {
    return this.urls.has(key);
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
    for (const [key, url] of this.urls) {
      if (this.retained <= this.budgetChars) return;
      if (url !== null && !this.holds.has(key)) this.forget(key);
    }
  }

  private forget(key: string): void {
    this.retained -= this.urls.get(key)?.length ?? 0;
    this.urls.delete(key);
  }
}
