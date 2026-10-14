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
  send(value: unknown): void {
    const socket = this.socket;
    if (socket?.readyState !== WebSocket.OPEN) return;
    if (socket.bufferedAmount > 256 * 1024) {
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
      const readyTimeout = setTimeout(() => {
        socket.close(1008, 'host authentication timeout');
      }, 10_000);
      readyTimeout.unref();
      let queue = Promise.resolve();
      let queued = 0;
      socket.on('message', (raw) => {
        if (socket !== this.socket) return;
        if (++queued > 32) {
          socket.close(1008, 'message limit');
          return;
        }
        queue = queue
          .then(async () => {
            if (socket !== this.socket) return;
            const value: unknown = JSON.parse(rawText(raw));
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
              this.backoff = 1000;
              this.handlers.status('connected');
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
      socket.on('close', () => {
        clearTimeout(readyTimeout);
        if (socket !== this.socket) return;
        this.socket = null;
        this.handlers.disconnected();
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

function rawText(raw: RawData): string {
  if (raw instanceof ArrayBuffer) return Buffer.from(raw).toString('utf8');
  if (Array.isArray(raw)) return Buffer.concat(raw).toString('utf8');
  return raw.toString('utf8');
}
