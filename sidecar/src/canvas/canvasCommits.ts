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

export class CanvasCommits {
  private queue: Promise<unknown> = Promise.resolve();
  private readonly admitted = new Set<Promise<void>>();
  private closing = false;

  constructor(private readonly changes: CanvasChangeFeed) {}

  /** Admits one mutation, so `drain` knows what it still has to wait for. */
  admit<T>(work: () => Promise<T>): Promise<T> {
    const running = (async () => work())();
    const settled = running.then(ignoreOutcome, ignoreOutcome);
    this.admitted.add(settled);
    void settled.then(() => this.admitted.delete(settled));
    return running;
  }

  /** One commit at a time; a failed commit never poisons the queue. */
  run<T>(work: () => Promise<T>): Promise<T> {
    const next = this.queue.catch(ignoreOutcome).then(() => {
      this.requireOpen();
      return work();
    });
    this.queue = next.catch(ignoreOutcome);
    return next;
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
    while (this.admitted.size > 0) await Promise.all([...this.admitted]);
  }
}

const ignoreOutcome = (): void => undefined;
