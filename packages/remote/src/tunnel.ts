import { decodeBase64, encodeBase64, isRecord } from './crypto';

// One encrypted message must stay under SecureChannel's 46,000-byte plaintext
// cap; base64 chunk data needs no JSON escaping, so its length is exact.
const CHUNK_CHARS = 40_000;
const COMPRESS_ABOVE_CHARS = 4_096;
const PACKET_CHARS = 4 * 1024 * 1024;
// The relay closes a receiver holding 16 frames or 256 KiB it has not yet
// acknowledged; four full chunks stay under both.
const WINDOW_CHUNKS = 4;
const MAX_QUEUED_CHARS = 64 * 1024 * 1024;

export interface SendLimits {
  bytesPerSecond: number;
  framesPerSecond: number;
}

// Below the relay's per-socket limits: the host may send 1 MiB and 480 frames
// a second, a browser 256 KiB and 120.
export const HOST_SEND_LIMITS: SendLimits = { bytesPerSecond: 800 * 1024, framesPerSecond: 400 };
export const BROWSER_SEND_LIMITS: SendLimits = { bytesPerSecond: 200 * 1024, framesPerSecond: 100 };

export type TunnelFrame =
  | { type: 'chunk'; seq: number; end: boolean; zip: boolean; data: string }
  | { type: 'ack'; seq: number };

/** Sliding one-second budget shared by every tunnel on one relay socket. */
export class SendBudget {
  private readonly sent: { at: number; bytes: number }[] = [];
  private bytes = 0;

  constructor(
    private readonly limits: SendLimits,
    private readonly now: () => number = Date.now,
  ) {}

  /** Reserves a frame and returns 0, or returns how many ms to wait first. */
  reserve(bytes: number): number {
    const now = this.now();
    while (this.sent.length > 0 && now - (this.sent[0]?.at ?? now) >= 1000) {
      this.bytes -= this.sent.shift()?.bytes ?? 0;
    }
    const fits =
      this.sent.length < this.limits.framesPerSecond &&
      (this.bytes + bytes <= this.limits.bytesPerSecond || this.sent.length === 0);
    if (fits) {
      this.sent.push({ at: now, bytes });
      this.bytes += bytes;
      return 0;
    }
    return Math.max(1, 1000 - (now - (this.sent[0]?.at ?? now)));
  }
}

/**
 * An ordered message stream over one SecureChannel. Queued messages travel
 * together as one packet, large packets are deflated and split into chunks,
 * and a small acknowledgement window paces the sender to the receiver.
 */
export class Tunnel {
  private outbox: string[] = [];
  private outboxChars = 0;
  private frames: TunnelFrame[] = [];
  private framesChars = 0;
  private sentSeq = 0;
  private ackedSeq = 0;
  private receivedSeq = 0;
  private ackDue = false;
  private parts: string[] = [];
  private partsChars = 0;
  private pumping = false;
  private closed = false;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private flushWaiters: (() => void)[] = [];

  constructor(
    private readonly options: {
      write: (frame: TunnelFrame) => Promise<void>;
      deliver: (message: unknown) => void;
      fail: (error: unknown) => void;
      /** Called whenever the send queue empties, so a paused producer can resume. */
      drained?: () => void;
      budget: SendBudget;
      /** Largest packet accepted from the other side, before and after inflation. */
      maxReceiveChars: number;
    },
  ) {}

  /** Characters waiting to be sent, so callers can shed load before the cap. */
  get queuedChars(): number {
    return this.outboxChars + this.framesChars;
  }

  send(message: unknown): void {
    if (this.closed) return;
    const text = JSON.stringify(message);
    if (this.queuedChars + text.length > MAX_QUEUED_CHARS) {
      this.fail(new Error('Remote send queue overflowed'));
      return;
    }
    this.outbox.push(text);
    this.outboxChars += text.length;
    void this.pump();
  }

  async receive(value: unknown): Promise<void> {
    if (this.closed) return;
    const frame = parseFrame(value);
    if (frame.type === 'ack') {
      if (frame.seq > this.sentSeq) throw new Error('Acknowledged an unsent remote frame');
      this.ackedSeq = Math.max(this.ackedSeq, frame.seq);
      void this.pump();
      return;
    }
    if (frame.seq !== this.receivedSeq + 1) throw new Error('Remote frame out of order');
    this.receivedSeq = frame.seq;
    this.ackDue = true;
    this.partsChars += frame.data.length;
    if (this.partsChars > this.options.maxReceiveChars) throw new Error('Remote packet too large');
    this.parts.push(frame.data);
    void this.pump();
    if (!frame.end) return;
    const data = this.parts.join('');
    this.parts = [];
    this.partsChars = 0;
    const text = frame.zip ? await inflate(data, this.options.maxReceiveChars) : data;
    const messages: unknown = JSON.parse(text);
    if (!Array.isArray(messages)) throw new Error('Invalid remote packet');
    for (const message of messages) {
      // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- A delivered message can close the tunnel.
      if (this.closed) return;
      this.options.deliver(message);
    }
  }

  /** Resolves once everything sent so far has been written, or the tunnel closes. */
  flush(): Promise<void> {
    if (this.closed || (this.queuedChars === 0 && !this.pumping)) return Promise.resolve();
    return new Promise((resolve) => this.flushWaiters.push(resolve));
  }

  close(): void {
    this.closed = true;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.outbox = [];
    this.frames = [];
    this.outboxChars = 0;
    this.framesChars = 0;
    this.settleFlush();
  }

  private settleFlush(): void {
    const waiters = this.flushWaiters;
    this.flushWaiters = [];
    for (const resolve of waiters) resolve();
  }

  private fail(error: unknown): void {
    if (this.closed) return;
    this.close();
    this.options.fail(error);
  }

  private async pump(): Promise<void> {
    if (this.pumping || this.closed || this.timer) return;
    this.pumping = true;
    try {
      // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- close() can run while a frame is written.
      while (!this.closed) {
        const next = this.nextFrame();
        if (!next) {
          if (this.outbox.length === 0 || this.windowFull()) break;
          await this.packOutbox();
          continue;
        }
        const wait = this.options.budget.reserve(frameBytes(next));
        if (wait > 0) {
          this.timer = setTimeout(() => {
            this.timer = null;
            void this.pump();
          }, wait);
          break;
        }
        if (next.type === 'ack') this.ackDue = false;
        else {
          this.frames.shift();
          this.framesChars -= next.data.length;
          next.seq = ++this.sentSeq;
        }
        await this.options.write(next);
      }
    } catch (error) {
      this.fail(error);
    } finally {
      this.pumping = false;
    }
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- close() can run while a frame is written.
    if (!this.closed && this.queuedChars === 0) {
      this.settleFlush();
      this.options.drained?.();
    }
  }

  private nextFrame(): TunnelFrame | null {
    if (this.ackDue) return { type: 'ack', seq: this.receivedSeq };
    if (this.windowFull()) return null;
    return this.frames[0] ?? null;
  }

  private windowFull(): boolean {
    return this.sentSeq - this.ackedSeq >= WINDOW_CHUNKS;
  }

  private async packOutbox(): Promise<void> {
    let count = 0;
    let chars = 0;
    while (count < this.outbox.length && (count === 0 || chars < PACKET_CHARS)) {
      chars += this.outbox[count]?.length ?? 0;
      count++;
    }
    const packet = `[${this.outbox.splice(0, count).join(',')}]`;
    this.outboxChars -= chars;
    if (packet.length <= COMPRESS_ABOVE_CHARS) {
      this.pushFrame({ type: 'chunk', seq: 0, end: true, zip: false, data: packet });
      return;
    }
    const data = encodeBase64(await deflate(packet));
    for (let start = 0; start < data.length; start += CHUNK_CHARS) {
      this.pushFrame({
        type: 'chunk',
        seq: 0,
        end: start + CHUNK_CHARS >= data.length,
        zip: true,
        data: data.slice(start, start + CHUNK_CHARS),
      });
    }
  }

  private pushFrame(frame: TunnelFrame & { type: 'chunk' }): void {
    this.frames.push(frame);
    this.framesChars += frame.data.length;
  }
}

function frameBytes(frame: TunnelFrame): number {
  // Ciphertext is base64 of the JSON plaintext plus the relay envelope.
  const plaintext = frame.type === 'ack' ? 40 : frame.data.length * 1.2 + 80;
  return Math.ceil((plaintext * 4) / 3 + 200);
}

function parseFrame(value: unknown): TunnelFrame {
  if (isRecord(value) && Number.isSafeInteger(value.seq) && typeof value.seq === 'number') {
    if (value.type === 'ack') return { type: 'ack', seq: value.seq };
    if (
      value.type === 'chunk' &&
      typeof value.end === 'boolean' &&
      typeof value.zip === 'boolean' &&
      typeof value.data === 'string' &&
      value.data.length <= CHUNK_CHARS
    ) {
      return { type: 'chunk', seq: value.seq, end: value.end, zip: value.zip, data: value.data };
    }
  }
  throw new Error('Invalid remote frame');
}

async function deflate(text: string): Promise<Uint8Array> {
  const stream = new Blob([text]).stream().pipeThrough(new CompressionStream('deflate-raw'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

async function inflate(data: string, maxChars: number): Promise<string> {
  const stream = new Blob([decodeBase64(data)])
    .stream()
    .pipeThrough(new DecompressionStream('deflate-raw'));
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let text = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) return text + decoder.decode();
    text += decoder.decode(value, { stream: true });
    if (text.length > maxChars) {
      await reader.cancel();
      throw new Error('Remote packet too large');
    }
  }
}
