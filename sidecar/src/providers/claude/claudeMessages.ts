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
