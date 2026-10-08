import {
  convertNotificationToStreamMessage,
  DroidWorkingState,
  StreamStateTracker,
  type DroidClient,
  type DroidStreamEvent,
} from '@factory/droid-sdk';
import { extractNotification } from './normalize.js';
import type { SteerOutcome } from './providers/session.js';
import { STEER_MESSAGE_PREFIX } from './sessionTranscriptParser.js';

// Notices of Droid working on its loop. A busy working state counts too; an
// error does not, since a loop can fail before it takes up a steer.
const LOOP_OUTPUT: ReadonlySet<unknown> = new Set([
  'assistant_text_delta',
  'thinking_text_delta',
  'tool_call',
  'tool_result',
  'tool_progress_update',
]);

// The working states the SDK's stream parses. It drops the rest, "thinking"
// among them.
const SDK_STATES: ReadonlySet<string> = new Set(Object.values(DroidWorkingState));

// One app turn may span several Droid loops. Only its final result settles it.
export class DroidTurn {
  private readonly deliveries = new Map<
    string,
    { resolve: (delivered: SteerOutcome) => void; received: boolean }
  >();
  private readonly tracker: StreamStateTracker;
  private readonly tail: unknown[] = [];
  private wake: (() => void) | undefined;
  private mainEnded = false;
  private busy = false;
  // The SDK settles the main loop only on an idle after a state it parses, and
  // it drops "thinking". These place the idle that ends a loop it never saw
  // working among the idle events its stream yields.
  private sdkSawMainWork = false;
  private mainIdles = 0;
  private openMainLoopIdle: number | undefined;
  private consumedMainIdles = 0;
  // A delivered steer whose reply loop has not yet run to idle. Droid can show
  // the message before that loop starts: while idle, or in a loop that then
  // fails or goes idle without working on it. Stop releases a wait for good.
  private loopOwed = false;
  private outputSinceDelivery = false;
  private stopped = false;
  private acceptingSteers = true;
  private interrupting: Promise<void> | undefined;
  private result: Extract<DroidStreamEvent, { type: 'result' }> | undefined;

  constructor(sessionId: string) {
    this.tracker = new StreamStateTracker({ sessionId, startedAt: Date.now() });
  }

  steer(
    client: Pick<DroidClient, 'addUserMessage'>,
    text: string,
    steerId: string,
  ): Promise<SteerOutcome> {
    // Leading slash commands can fail without a delivery or discard notice.
    if (!this.acceptingSteers || this.interrupting || /^\s*\//.test(text))
      return Promise.resolve(false);
    const messageId = `${STEER_MESSAGE_PREFIX}${steerId}`;
    const delivered = new Promise<SteerOutcome>((resolve) =>
      this.deliveries.set(messageId, { resolve, received: false }),
    );
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
    if (LOOP_OUTPUT.has(raw.type)) this.outputSinceDelivery = true;
    const wasMainEnded = this.mainEnded;
    if (
      raw.type === 'droid_working_state_changed' &&
      'newState' in raw &&
      typeof raw.newState === 'string'
    )
      this.observeState(raw.newState);
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
    ) {
      const delivery = this.deliveries.get(message.id);
      if (!delivery || delivery.received) return;
      // Loop bookkeeping follows raw notices; the row waits for ordered consumption.
      delivery.received = true;
      this.loopOwed = true;
      this.outputSinceDelivery = false;
    }
  }

  private observeState(newState: string): void {
    const wasBusy = this.busy;
    this.busy = newState !== 'idle';
    if (this.busy) {
      this.outputSinceDelivery = true;
      if (SDK_STATES.has(newState)) this.sdkSawMainWork = true;
      return;
    }
    if (!this.mainEnded) {
      this.mainIdles += 1;
      if (wasBusy && !this.sdkSawMainWork) this.openMainLoopIdle = this.mainIdles;
    }
    if (wasBusy) {
      this.mainEnded = true;
      if (this.outputSinceDelivery) this.loopOwed = false;
    }
  }

  // Counts this SDK event if it is an idle, and says whether that idle ends a
  // main loop the SDK will never settle. Raw notices run ahead of the SDK, so
  // idles are counted as it yields them: once per event, in order.
  consumeIdleEndsOpenLoop(event: DroidStreamEvent): boolean {
    if (event.type !== 'working_state_changed' || event.state !== DroidWorkingState.Idle)
      return false;
    this.consumedMainIdles += 1;
    return this.consumedMainIdles === this.openMainLoopIdle;
  }

  observeMainEvent(event: DroidStreamEvent): void {
    if (event.type === 'user') this.settle(event.message.id, true);
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
      if (event.type === 'user') this.settle(event.message.id, true);
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
  }

  // Wakes the tail even with no waiter left to settle: an owed loop may have
  // been all it was waiting for.
  private dropSteers(): void {
    this.acceptingSteers = false;
    this.loopOwed = false;
    for (const messageId of this.deliveries.keys()) this.settle(messageId, false);
    this.wake?.();
  }

  private settle(messageId: string, delivered: boolean): void {
    const delivery = this.deliveries.get(messageId);
    // A rejection or interrupt cannot undo an echo still waiting behind output.
    if (!delivered && delivery?.received && !this.stopped) return;
    delivery?.resolve(!delivered && delivery.received ? 'unconfirmed' : delivered);
    this.deliveries.delete(messageId);
    this.wake?.();
  }
}
