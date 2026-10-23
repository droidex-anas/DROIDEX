import WebSocket, { type RawData } from 'ws';
import {
  claimProof,
  hostProof,
  isRecord,
  signIdentity,
  type Identity,
} from '../../../packages/remote/src/index.js';

export async function claimHandle(
  origin: string,
  handle: string,
  identity: Identity,
): Promise<void> {
  const base = new URL(origin);
  base.protocol = base.protocol === 'wss:' ? 'https:' : 'http:';
  base.pathname = `/v1/handles/${handle}`;
  const response = await fetch(`${base.href}/challenge`, {
    method: 'POST',
    signal: AbortSignal.timeout(8000),
  });
  if (!response.ok) throw new Error('Relay unavailable. Check its address and try again');
  const value: unknown = await response.json();
  if (!isRecord(value) || typeof value.challenge !== 'string')
    throw new Error('Invalid relay challenge');
  const signature = await signIdentity(identity.privateKey, claimProof(handle, value.challenge));
  const result = await fetch(`${base.href}/claim`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ publicKey: identity.publicKey, challenge: value.challenge, signature }),
    signal: AbortSignal.timeout(8000),
  });
  if (!result.ok)
    throw new Error(
      'This username is unavailable. Choose another before setting up your authenticator',
    );
}

// The relay answers a raw 'ping' itself; two missed answers mean the socket
// died without a close, as it does when the laptop sleeps or changes network.
const HEARTBEAT_MS = 30_000;
const SILENCE_LIMIT_MS = 65_000;

export class RelayConnection {
  private socket: WebSocket | null = null;
  private running = false;
  private generation = 0;
  private retry: ReturnType<typeof setTimeout> | null = null;
  private backoff = 1000;
  constructor(
    private readonly credentials: () => { origin: string; handle: string; identity: Identity },
    private readonly handlers: {
      status: (status: 'connecting' | 'connected' | 'error', error?: string) => void;
      open: (peerId: string, isCurrent: () => boolean) => Promise<void>;
      payload: (peerId: string, value: unknown) => void;
      close: (peerId: string) => void;
      disconnected: () => void;
    },
  ) {}
  start(): void {
    if (this.running) return;
    this.running = true;
    this.connect();
  }
  stop(): void {
    this.running = false;
    this.generation++;
    if (this.retry) clearTimeout(this.retry);
    this.retry = null;
    const socket = this.socket;
    this.socket = null;
    socket?.close();
    this.handlers.disconnected();
  }
  /** Replaces the socket at once, for when the network may have changed under it. */
  reconnect(): void {
    if (!this.running) return;
    this.stop();
    this.start();
  }
  send(value: unknown): void {
    const socket = this.socket;
    if (socket?.readyState !== WebSocket.OPEN) return;
    // Each browser's tunnel keeps at most four chunks in flight, so only a
    // stalled socket grows past this.
    if (socket.bufferedAmount > 2 * 1024 * 1024) {
      socket.close(1013, 'slow connection');
      return;
    }
    socket.send(JSON.stringify(value));
  }
  private connect(): void {
    const generation = ++this.generation;
    this.handlers.status('connecting');
    try {
      const { origin, handle, identity } = this.credentials();
      if (!this.running || generation !== this.generation) return;
      const url = new URL(origin);
      url.pathname = `/v1/handles/${handle}/socket`;
      const socket = new WebSocket(url, { maxPayload: 65_536, handshakeTimeout: 8000 });
      this.socket = socket;
      let ready = false;
      let lastReceivedAt = Date.now();
      let heartbeat: ReturnType<typeof setInterval> | undefined;
      const readyTimeout = setTimeout(() => {
        socket.terminate();
      }, 10_000);
      readyTimeout.unref();
      let queue = Promise.resolve();
      let queued = 0;
      socket.on('message', (raw) => {
        if (socket !== this.socket) return;
        lastReceivedAt = Date.now();
        const text = rawText(raw);
        if (text === 'pong') return;
        if (++queued > 32) {
          socket.close(1008, 'message limit');
          return;
        }
        queue = queue
          .then(async () => {
            if (socket !== this.socket) return;
            const value: unknown = JSON.parse(text);
            if (!isRecord(value)) throw new Error('Invalid relay frame');
            if (value.type === 'forward' && typeof value.deliveryId === 'number')
              socket.send(JSON.stringify({ type: 'received', deliveryId: value.deliveryId }));
            if (value.type === 'relay-ready' && typeof value.challenge === 'string') {
              const signature = await signIdentity(
                identity.privateKey,
                hostProof(handle, value.challenge),
              );
              if (socket === this.socket)
                this.send({ type: 'host-auth', publicKey: identity.publicKey, signature });
            } else if (value.type === 'host-ready') {
              clearTimeout(readyTimeout);
              ready = true;
              this.backoff = 1000;
              this.handlers.status('connected');
              heartbeat = setInterval(() => {
                if (Date.now() - lastReceivedAt > SILENCE_LIMIT_MS) socket.terminate();
                else socket.send('ping');
              }, HEARTBEAT_MS);
              heartbeat.unref();
            } else if (value.type === 'peer-open' && typeof value.peerId === 'string')
              await this.handlers.open(value.peerId, () => socket === this.socket);
            else if (value.type === 'peer-close' && typeof value.peerId === 'string')
              this.handlers.close(value.peerId);
            else if (value.type === 'forward' && typeof value.peerId === 'string')
              this.handlers.payload(value.peerId, value.payload);
          })
          .catch(() => {
            socket.close(1002, 'invalid relay frame');
          })
          .finally(() => {
            queued--;
          });
      });
      socket.on('error', () => {
        socket.close();
      });
      socket.on('close', (code) => {
        clearTimeout(readyTimeout);
        clearInterval(heartbeat);
        if (socket !== this.socket) return;
        this.socket = null;
        this.handlers.disconnected();
        // The relay refuses a laptop whose key does not own the username;
        // retrying cannot change that, so wait for the user.
        if (!ready && code === 1008) {
          this.running = false;
          this.handlers.status(
            'error',
            'The relay did not accept this laptop as the owner of this username',
          );
          return;
        }
        this.handlers.status('connecting');
        this.schedule();
      });
    } catch (cause) {
      if (generation !== this.generation) return;
      this.handlers.status('error', cause instanceof Error ? cause.message : 'Connection failed');
      this.schedule();
    }
  }
  private schedule(): void {
    if (!this.running || this.retry) return;
    this.retry = setTimeout(
      () => {
        this.retry = null;
        this.connect();
      },
      this.backoff + Math.random() * 250,
    );
    this.retry.unref();
    this.backoff = Math.min(this.backoff * 2, 30_000);
  }
}

export function rawText(raw: RawData): string {
  if (raw instanceof ArrayBuffer) return Buffer.from(raw).toString('utf8');
  if (Array.isArray(raw)) return Buffer.concat(raw).toString('utf8');
  return raw.toString('utf8');
}
