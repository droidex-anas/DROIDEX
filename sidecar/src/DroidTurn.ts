import { randomUUID } from 'node:crypto';
import {
  convertNotificationToStreamMessage,
  StreamStateTracker,
  type DroidClient,
  type DroidStreamEvent,
} from '@factory/droid-sdk';
import { extractNotification } from './normalize.js';

// One app turn may span several Droid loops. Only its final result settles it.
export class DroidTurn {
  private readonly deliveries = new Map<string, (delivered: boolean) => void>();
  private readonly tracker: StreamStateTracker;
  private readonly tail: unknown[] = [];
  private wake: (() => void) | undefined;
  private mainEnded = false;
  private busy = false;
  // A delivered steer whose reply loop has not yet run to idle. Droid can show
  // the message while still idle, a moment before that loop starts.
  private loopOwed = false;
  private stopped = false;
  private acceptingSteers = true;
  private interrupting: Promise<void> | undefined;
  private result: Extract<DroidStreamEvent, { type: 'result' }> | undefined;

  constructor(sessionId: string) {
    this.tracker = new StreamStateTracker({ sessionId, startedAt: Date.now() });
  }

  steer(client: DroidClient, text: string): Promise<boolean> {
    // Embedded slash commands can fail without a delivery or discard notice.
    if (!this.acceptingSteers || this.interrupting || /(^|\s)\//.test(text))
      return Promise.resolve(false);
    const messageId = randomUUID();
    const delivered = new Promise<boolean>((resolve) => this.deliveries.set(messageId, resolve));
    void client.addUserMessage({ text, messageId }).catch(() => {
      this.settle(messageId, false);
    });
    return delivered;
  }

  interrupt(sendInterrupt: () => Promise<void>): Promise<void> {
    if (this.interrupting) return this.interrupting;
    this.interrupting = sendInterrupt()
      .then(() => {
        this.dropSteers();
      })
      .finally(() => {
        this.interrupting = undefined;
        this.wake?.();
      });
    return this.interrupting;
  }

  observe(notification: Record<string, unknown>): void {
    if (this.stopped) return;
    const raw = extractNotification(notification);
    if (!raw || typeof raw !== 'object' || !('type' in raw)) return;
    if (raw.type === 'queued_messages_discarded') {
      this.dropSteers();
      return;
    }
    if (raw.type === 'create_message' && 'message' in raw) this.observeDelivery(raw.message);
    const wasMainEnded = this.mainEnded;
    if (
      raw.type === 'droid_working_state_changed' &&
      'newState' in raw &&
      typeof raw.newState === 'string'
    ) {
      const wasBusy = this.busy;
      this.busy = raw.newState !== 'idle';
      if (wasBusy && !this.busy) {
        this.mainEnded = true;
        this.loopOwed = false;
      }
    }
    // The SDK owns the main loop. Buffer later notices even before its iterator
    // drains. The main loop's own idle still wakes a tail already waiting on it.
    if (!wasMainEnded) {
      this.wake?.();
      return;
    }
    this.tail.push(raw);
    this.wake?.();
  }

  private observeDelivery(message: unknown): void {
    if (
      message &&
      typeof message === 'object' &&
      'role' in message &&
      message.role === 'user' &&
      'id' in message &&
      typeof message.id === 'string'
    )
      this.settle(message.id, true);
  }

  observeMainEvent(event: DroidStreamEvent): void {
    if (event.type !== 'tool_call' && event.type !== 'tool_call_delta') return;
    this.tracker.processMessage({
      type: 'tool_use',
      toolUseId: event.toolUse.id,
      toolName: event.toolUse.name,
      toolInput: event.toolUse.input,
    });
  }

  async *streamTail(): AsyncGenerator<DroidStreamEvent, void, undefined> {
    try {
      while (
        this.tail.length > 0 ||
        (!this.stopped &&
          (this.deliveries.size > 0 || this.busy || this.loopOwed || this.interrupting))
      ) {
        if (this.tail.length > 0) {
          yield* this.trackTailNotification(this.tail.shift());
          continue;
        }
        await new Promise<void>((resolve) => {
          this.wake = resolve;
        });
        this.wake = undefined;
      }
    } finally {
      // Close admission before async-generator completion becomes observable.
      this.acceptingSteers = false;
    }
  }

  private *trackTailNotification(raw: unknown): Generator<DroidStreamEvent> {
    const converted = convertNotificationToStreamMessage(raw);
    if (!converted) return;
    for (const event of Array.isArray(converted) ? converted : [converted]) {
      const { message, additional } = this.tracker.processMessage(event);
      for (const extra of additional) {
        if (extra.type === 'result') this.result = extra;
      }
      // Internal frames are not SDK stream events.
      if (
        message &&
        message.type !== 'create_message' &&
        message.type !== 'structured_output' &&
        message.type !== 'tool_use'
      )
        yield message;
    }
  }

  finalResult(mainResult: DroidStreamEvent | undefined): DroidStreamEvent | undefined {
    if (this.result && mainResult?.type === 'result')
      return {
        ...this.result,
        numTurns: mainResult.numTurns + this.result.numTurns,
        turnCount: mainResult.turnCount + this.result.turnCount,
      };
    return this.result ?? mainResult;
  }

  stop(): void {
    this.stopped = true;
    this.dropSteers();
    this.wake?.();
  }

  private dropSteers(): void {
    this.acceptingSteers = false;
    this.loopOwed = false;
    for (const messageId of this.deliveries.keys()) this.settle(messageId, false);
  }

  private settle(messageId: string, delivered: boolean): void {
    if (delivered && this.deliveries.has(messageId)) this.loopOwed = true;
    this.deliveries.get(messageId)?.(delivered);
    this.deliveries.delete(messageId);
    this.wake?.();
  }
}
