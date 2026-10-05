import { randomUUID } from 'node:crypto';
import {
  convertNotificationToStreamMessage,
  StreamStateTracker,
  DroidWorkingState,
  type DroidClient,
  type DroidStreamEvent,
} from '@factory/droid-sdk';
import { extractNotification } from './normalize.js';

// One app turn may span several Droid loops. Only its final result settles it.
export class DroidTurn {
  private readonly deliveries = new Map<string, (delivered: boolean) => void>();
  private readonly tracker: StreamStateTracker;
  private readonly tail: DroidStreamEvent[] = [];
  private wake: (() => void) | undefined;
  private mainEnded = false;
  private busy = false;
  private stopped = false;
  private result: DroidStreamEvent | undefined;

  constructor(sessionId: string) {
    this.tracker = new StreamStateTracker({ sessionId, startedAt: Date.now() });
  }

  async steer(client: DroidClient, text: string): Promise<boolean> {
    if (this.stopped || text.trimStart().startsWith('/')) return false;
    const messageId = randomUUID();
    const delivered = new Promise<boolean>((resolve) => this.deliveries.set(messageId, resolve));
    try {
      await client.addUserMessage({ text, messageId });
    } catch (error) {
      this.settle(messageId, false);
      throw error;
    }
    return delivered;
  }

  observe(notification: Record<string, unknown>): void {
    if (this.stopped) return;
    const raw = extractNotification(notification);
    if (
      raw &&
      typeof raw === 'object' &&
      'type' in raw &&
      raw.type === 'queued_messages_discarded'
    ) {
      this.stop();
      return;
    }
    const converted = convertNotificationToStreamMessage(raw);
    if (!converted) return;
    const messages = Array.isArray(converted) ? converted : [converted];
    for (const event of messages) this.trackMessage(event);
    this.wake?.();
  }

  private trackMessage(event: Parameters<StreamStateTracker['processMessage']>[0]): void {
    const { message, additional } = this.tracker.processMessage(event);
    if (event.type === 'user') this.settle(event.message.id, true);
    if (event.type === 'working_state_changed') this.busy = event.state !== DroidWorkingState.Idle;
    if (this.mainEnded && message) {
      // Internal create_message/structured_output frames are not SDK stream events.
      if (
        message.type !== 'create_message' &&
        message.type !== 'structured_output' &&
        message.type !== 'tool_use'
      )
        this.tail.push(message);
    }
    for (const extra of additional) {
      if (extra.type !== 'result') continue;
      this.result = extra;
      this.mainEnded = true;
    }
  }

  async *streamTail(): AsyncGenerator<DroidStreamEvent, void, undefined> {
    while (this.tail.length > 0 || (!this.stopped && (this.deliveries.size > 0 || this.busy))) {
      const event = this.tail.shift();
      if (event) {
        yield event;
        continue;
      }
      await new Promise<void>((resolve) => {
        this.wake = resolve;
      });
      this.wake = undefined;
    }
  }

  finalResult(mainResult: DroidStreamEvent | undefined): DroidStreamEvent | undefined {
    return this.result ?? mainResult;
  }

  stop(): void {
    this.stopped = true;
    for (const messageId of this.deliveries.keys()) this.settle(messageId, false);
    this.wake?.();
  }

  private settle(messageId: string, delivered: boolean): void {
    this.deliveries.get(messageId)?.(delivered);
    this.deliveries.delete(messageId);
    this.wake?.();
  }
}
