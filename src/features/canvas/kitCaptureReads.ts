// Kit capture reads share the canvas client's pending-request cap with kit fonts
// and preview builds, so a document with many tiles sends them a few at a time,
// oldest first. A read nobody shows any more is dropped before it is sent, so the
// next document's reads never wait behind the last one's.

export class KitCaptureReads {
  private readonly waiting = new Map<string, () => Promise<void>>();
  private readonly sent = new Set<string>();

  constructor(private readonly maxInFlight: number) {}

  /** Sends `read` now or once an earlier one settles; a key already waiting or sent is read once. */
  request(key: string, read: () => Promise<void>): void {
    if (this.waiting.has(key) || this.sent.has(key)) return;
    if (this.sent.size < this.maxInFlight) this.send(key, read);
    else this.waiting.set(key, read);
  }

  /** Drops the read waiting for `key`; one already sent settles as usual. */
  cancel(key: string): void {
    this.waiting.delete(key);
  }

  private send(key: string, read: () => Promise<void>): void {
    this.sent.add(key);
    void read().finally(() => {
      this.sent.delete(key);
      const oldest = this.waiting.entries().next();
      if (oldest.done) return;
      const [nextKey, nextRead] = oldest.value;
      this.waiting.delete(nextKey);
      this.send(nextKey, nextRead);
    });
  }
}
