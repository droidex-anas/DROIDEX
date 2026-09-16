import type { Query, SDKMessage, SDKUserMessage } from '@anthropic-ai/claude-agent-sdk';

export class PromptQueue implements AsyncIterable<SDKUserMessage> {
  private readonly queued: SDKUserMessage[] = [];
  private waiting?: (result: IteratorResult<SDKUserMessage>) => void;
  private closed = false;

  push(message: SDKUserMessage): void {
    const waiting = this.waiting;
    if (waiting) {
      this.waiting = undefined;
      waiting({ value: message, done: false });
    } else this.queued.push(message);
  }

  close(): void {
    this.closed = true;
    this.queued.length = 0;
    this.waiting?.({ value: undefined, done: true });
    this.waiting = undefined;
  }

  [Symbol.asyncIterator](): AsyncIterator<SDKUserMessage> {
    return {
      next: async () => {
        const queued = this.queued.shift();
        if (queued) return { value: queued, done: false };
        if (this.closed) return { value: undefined, done: true };
        return await new Promise<IteratorResult<SDKUserMessage>>((resolve) => {
          this.waiting = resolve;
        });
      },
    };
  }
}

// Keep consuming notifications between turns; catalog changes must not wait for
// the next prompt, while idle transcript output has no turn to attach to.
export class ClaudeMessages {
  private readonly queued: SDKMessage[] = [];
  private waiting?: (result: IteratorResult<SDKMessage>) => void;
  private closed = false;

  async consume(
    query: Query,
    observe: (message: SDKMessage) => void,
    inTurn: () => boolean,
  ): Promise<void> {
    for await (const message of query) {
      if (this.closed) return;
      observe(message);
      if (!inTurn()) continue;
      const waiting = this.waiting;
      if (waiting) {
        this.waiting = undefined;
        waiting({ value: message, done: false });
      } else this.queued.push(message);
    }
    this.close();
  }

  next(): Promise<IteratorResult<SDKMessage>> {
    const message = this.queued.shift();
    if (message) return Promise.resolve({ value: message, done: false });
    if (this.closed) return Promise.resolve({ value: undefined, done: true });
    return new Promise((resolve) => {
      this.waiting = resolve;
    });
  }

  close(): void {
    this.closed = true;
    this.queued.length = 0;
    this.waiting?.({ value: undefined, done: true });
    this.waiting = undefined;
  }
}
