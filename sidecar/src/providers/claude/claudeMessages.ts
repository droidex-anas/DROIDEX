import type {
  Query,
  SDKControlInterruptResponse,
  SDKMessage,
} from '@anthropic-ai/claude-agent-sdk';

// Input prompts and per-turn output each have one producer and one reader.
export class MessageQueue<T> implements AsyncIterable<T> {
  private readonly queued: T[] = [];
  private waiting?: { resolve: (value: IteratorResult<T>) => void; reject: (error: Error) => void };
  private ended = false;
  private failure?: Error;

  push(message: T): void {
    if (this.ended) return;
    const waiting = this.waiting;
    if (waiting) {
      this.waiting = undefined;
      waiting.resolve({ value: message, done: false });
    } else this.queued.push(message);
  }

  /** What was queued and never read, taken out of the queue. */
  drain(): T[] {
    return this.queued.splice(0);
  }

  close(error?: Error): void {
    if (this.ended) return;
    this.ended = true;
    this.failure = error;
    const waiting = this.waiting;
    this.waiting = undefined;
    if (error) waiting?.reject(error);
    else waiting?.resolve({ value: undefined, done: true });
  }

  async next(): Promise<IteratorResult<T>> {
    if (this.queued.length > 0) return { value: this.queued.shift() as T, done: false };
    if (this.failure) throw this.failure;
    if (this.ended) return { value: undefined, done: true };
    return await new Promise((resolve, reject) => {
      this.waiting = { resolve, reject };
    });
  }

  [Symbol.asyncIterator](): AsyncIterator<T> {
    return this;
  }
}

// Control requests the SDK sends at runtime but does not declare.
export type SteeringQuery = Query & {
  interrupt(options: { cancelQueued: boolean }): Promise<SDKControlInterruptResponse | undefined>;
  cancelAsyncMessage(uuid: string): Promise<boolean>;
};

// The CLI reports each queued prompt's progress in a frame the SDK does not
// declare either: 'started' when the model takes it in, 'cancelled' when it is
// dropped.
export function commandLifecycle(message: SDKMessage): { uuid: string; state: string } | undefined {
  const frame = message as unknown as { type?: unknown; command_uuid?: unknown; state?: unknown };
  if (
    frame.type !== 'command_lifecycle' ||
    typeof frame.command_uuid !== 'string' ||
    typeof frame.state !== 'string'
  )
    return undefined;
  return { uuid: frame.command_uuid, state: frame.state };
}

export function turnFailure(subtype: string, errors: string[]): string {
  // The CLI's own diagnostics are bracketed internals; the subtype is what a
  // user can act on.
  const detail = errors.filter((error) => !error.startsWith('[')).join('\n');
  return detail
    ? `Claude Code ended the turn (${subtype}): ${detail}`
    : `Claude Code ended the turn (${subtype}).`;
}

export function isSlashCommand(text: string): boolean {
  return text.trimStart().startsWith('/');
}

export function answersTurn(
  message: { user_message_uuid?: string; user_message_uuids?: string[] },
  turnId: string,
): boolean {
  // The plural list names every prompt the turn has consumed, so where it
  // exists it is the whole answer: a result that omits this turn's uuid belongs
  // to another turn, whatever the singular field says.
  if (message.user_message_uuids) return message.user_message_uuids.includes(turnId);
  if (message.user_message_uuid !== undefined) return message.user_message_uuid === turnId;
  // Older CLIs stamp neither field; their result can only be this turn's.
  return true;
}
