import type { NormalizedEvent } from '../../normalize.js';

// One turn's events, filled by the notification handlers and drained by the
// turn that is streaming. Events that arrive outside a turn have no transcript
// to land in and are dropped.
export class TurnStream {
  private readonly queued: NormalizedEvent[] = [];
  private waiting?: () => void;
  private settlement?: Error | 'done';

  push(events: NormalizedEvent[]): void {
    this.queued.push(...events);
    this.wake();
  }

  finish(): void {
    this.settlement ??= 'done';
    this.wake();
  }

  // First settlement wins: whichever of the failing error notification, the
  // failed turn or the dead process arrives first is the turn's cause.
  fail(error: Error): void {
    this.settlement ??= error;
    this.wake();
  }

  async *drain(): AsyncGenerator<NormalizedEvent, void, undefined> {
    for (;;) {
      const next = this.queued.shift();
      if (next) {
        yield next;
        continue;
      }
      if (this.settlement === 'done') return;
      if (this.settlement) throw this.settlement;
      await new Promise<void>((resolve) => {
        this.waiting = resolve;
      });
    }
  }

  private wake(): void {
    const waiting = this.waiting;
    this.waiting = undefined;
    waiting?.();
  }
}
