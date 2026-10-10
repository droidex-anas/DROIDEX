// One canvas workspace's mutation queue. Every mutation is admitted here, so
// closing knows what it still has to wait for; every commit runs alone, so two
// writers cannot interleave their manifests; and a committed change is published
// after the lock has moved on, so a subscriber cannot stall the next commit.

import type { CanvasChangeFeed } from './canvasChangeFeed.js';
import { canvasError } from './canvasError.js';
import type { CanvasChange } from './protocol.js';

/** What a mutation admitted before the workspace closed is refused with. */
export const CLOSING = 'The Canvas workspace is closing.';

/** A commit's answer and the change it published, if it published one. */
export interface Committed<T> {
  value: T;
  change?: CanvasChange;
}

/** Cancels queued work and fences only the durable operation that starts. */
export interface CanvasCommitOwner {
  readonly signal: AbortSignal;
  readonly isCurrent: () => boolean;
  commit<T>(operation: () => Promise<T>): Promise<T>;
}

export class CanvasCommits {
  private queue: Promise<unknown> = Promise.resolve();
  private readonly admitted = new Set<Promise<void>>();
  private readonly queued = new Set<(error: Error) => void>();
  private closing = false;

  constructor(private readonly changes: CanvasChangeFeed) {}

  /** Admits one mutation, so `drain` knows what it still has to wait for. */
  admit<T>(work: () => Promise<T>): Promise<T> {
    if (this.closing) return Promise.reject(canvasError('storage_failed', CLOSING));
    const running = (async () => work())();
    const settled = running.then(ignoreOutcome, ignoreOutcome);
    this.admitted.add(settled);
    void settled.then(() => this.admitted.delete(settled));
    return running;
  }

  /** One commit at a time; a failed commit never poisons the queue. */
  run<T>(work: () => Promise<T>, signal?: AbortSignal): Promise<T> {
    if (this.closing) return Promise.reject(canvasError('storage_failed', CLOSING));
    const cancelled = () =>
      canvasError('scope_expired', 'The session closed before its first turn.');
    if (signal?.aborted) return Promise.reject(cancelled());
    return new Promise<T>((resolve, reject) => {
      const release = (): void => {
        this.queued.delete(refuse);
        signal?.removeEventListener('abort', abort);
      };
      const refuse = (error: Error): void => {
        release();
        reject(error);
      };
      const abort = (): void => {
        refuse(cancelled());
      };
      this.queued.add(refuse);
      signal?.addEventListener('abort', abort, { once: true });
      const next = this.queue.then(() => {
        release();
        if (signal?.aborted) throw cancelled();
        this.requireOpen();
        return work();
      });
      this.queue = next.then(ignoreOutcome, ignoreOutcome);
      void next.then(resolve, reject);
    });
  }

  /**
   * A commit that may publish a change. Listeners run once the lock has moved
   * on, so a subscriber cannot stall the next commit, and still in sequence,
   * because the queue hands the lock on in an earlier microtask.
   */
  publish<T>(work: () => Promise<Committed<T>>): Promise<T> {
    return this.run(work).then(({ value, change }) => {
      if (change) this.changes.publish(change);
      return value;
    });
  }

  requireOpen(): void {
    if (this.closing) throw canvasError('storage_failed', CLOSING);
  }

  /** Resolves once every admitted mutation has settled, staging included. */
  async drain(): Promise<void> {
    this.closing = true;
    for (const reject of this.queued) reject(canvasError('storage_failed', CLOSING));
    this.queued.clear();
    while (this.admitted.size > 0) await Promise.all([...this.admitted]);
  }
}

const ignoreOutcome = (): void => undefined;
