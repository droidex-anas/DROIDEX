import {
  acceptHostHello,
  BROWSER_SEND_LIMITS,
  isRecord,
  MAX_RELAY_FRAME_BYTES,
  SendBudget,
  signIdentity,
  Tunnel,
  type SecureChannel,
} from '../../packages/remote/src/index';
import {
  remoteMessage,
  toWire,
  type RemoteDesktopEvent,
  type RemoteDesktopMethod,
  type RemoteMessage,
  type RemoteRequest,
} from '../../packages/remote/src/application';
import { LAST_HANDLE_KEY, prepareDevice, writeDevice, type BrowserDevice } from './deviceStore';
import { RemoteBridgeSocket, RemoteTerminalChannel } from './remoteChannels';

const DEFAULT_RELAY_URL = 'wss://droidex-relay.mdanas7869292.workers.dev';
const HANDSHAKE_TIMEOUT_MS = 10_000;
const HEARTBEAT_MS = 30_000;
const SILENCE_LIMIT_MS = 65_000;
// The laptop's reply to a request that reads a large file can take a while.
const CALL_TIMEOUT_MS = 120_000;
const MAX_LAPTOP_PACKET_CHARS = 64 * 1024 * 1024;

export type ConnectionStatus =
  | { kind: 'connecting' }
  | { kind: 'offline' }
  | { kind: 'code'; feedback: string }
  | { kind: 'pairing' }
  | { kind: 'ready'; pushPublicKey: string | null }
  | { kind: 'denied' }
  | { kind: 'removed' }
  | { kind: 'error'; message: string };

interface PendingCall {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

interface Link {
  socket: WebSocket;
  channel: SecureChannel | null;
  tunnel: Tunnel | null;
}

/**
 * One browser's encrypted link to the laptop: the relay socket, the pairing
 * handshake, and every call, bridge socket and terminal riding on it.
 * Reconnects on its own until disposed.
 */
export class RemoteConnection {
  status: ConnectionStatus = { kind: 'connecting' };
  device: BrowserDevice | null = null;
  private link: Link | null = null;
  private generation = 0;
  private attempts = 0;
  private disposed = false;
  private nextId = 1;
  private lastReceivedAt = 0;
  private timers: ReturnType<typeof setTimeout>[] = [];
  private heartbeat: ReturnType<typeof setInterval> | undefined;
  private readonly calls = new Map<number, PendingCall>();
  private readonly bridges = new Map<number, RemoteBridgeSocket>();
  private readonly terminals = new Map<string, RemoteTerminalChannel>();
  private readonly listeners = new Map<RemoteDesktopEvent, Set<(payload: unknown) => void>>();
  private readonly statusListeners = new Set<(status: ConnectionStatus) => void>();
  private readonly budget = new SendBudget(BROWSER_SEND_LIMITS);

  constructor(
    readonly handle: string,
    private readonly pin: string,
  ) {
    window.addEventListener('online', this.resume);
    document.addEventListener('visibilitychange', this.resume);
    void this.connect();
  }

  onStatus(listener: (status: ConnectionStatus) => void): () => void {
    this.statusListeners.add(listener);
    return () => this.statusListeners.delete(listener);
  }

  retry(): void {
    this.attempts = 0;
    void this.connect();
  }

  dispose(): void {
    this.disposed = true;
    window.removeEventListener('online', this.resume);
    document.removeEventListener('visibilitychange', this.resume);
    this.disconnect('This browser was signed out.');
  }

  async authenticate(code?: string): Promise<void> {
    const link = this.link;
    if (!link?.channel || !link.tunnel || !this.device)
      throw new Error('Wait for your laptop to connect, then retry.');
    if (code) this.setStatus({ kind: 'pairing' });
    let deviceName = 'Web browser';
    if (/iPhone|iPad/.test(navigator.userAgent)) deviceName = 'Safari on iPhone / iPad';
    else if (navigator.userAgent.includes('Android')) deviceName = 'Android browser';
    link.tunnel.send({
      type: 'auth',
      publicKey: this.device.identity.publicKey,
      signature: await signIdentity(this.device.identity.privateKey, link.channel.challenge),
      deviceName,
      ...(code ? { code } : {}),
    } satisfies RemoteRequest);
  }

  call(method: RemoteDesktopMethod, args: unknown[]): Promise<unknown> {
    return this.request((id) => ({ type: 'call', id, method, args: toWire(args) as unknown[] }));
  }

  updatePush(subscription: unknown): Promise<unknown> {
    return this.request((id) =>
      subscription === null
        ? { type: 'push.unsubscribe', id }
        : { type: 'push.subscribe', id, subscription },
    );
  }

  listen(event: RemoteDesktopEvent, handler: (payload: unknown) => void): () => void {
    let handlers = this.listeners.get(event);
    if (!handlers) {
      handlers = new Set();
      this.listeners.set(event, handlers);
    }
    handlers.add(handler);
    return () => handlers.delete(handler);
  }

  openBridge(params: string): RemoteBridgeSocket {
    const socketId = this.nextId++;
    const socket = new RemoteBridgeSocket(
      socketId,
      (request) => {
        this.send(request);
      },
      () => {
        this.bridges.delete(socketId);
      },
    );
    if (this.status.kind !== 'ready') {
      queueMicrotask(() => {
        socket.closed(1006, 'Your laptop is not connected');
      });
      return socket;
    }
    this.bridges.set(socketId, socket);
    this.send({ type: 'bridge.open', socketId, params });
    return socket;
  }

  openTerminal(terminalId: string): RemoteTerminalChannel {
    this.terminals.get(terminalId)?.close();
    const terminal = new RemoteTerminalChannel(
      terminalId,
      (request) => {
        this.send(request);
      },
      () => {
        if (this.terminals.get(terminalId) === terminal) this.terminals.delete(terminalId);
      },
    );
    if (this.status.kind !== 'ready') {
      queueMicrotask(() => {
        terminal.disconnected();
      });
      return terminal;
    }
    this.terminals.set(terminalId, terminal);
    this.send({ type: 'terminal.open', terminalId });
    return terminal;
  }

  private readonly resume = () => {
    if (document.visibilityState !== 'visible' || this.disposed) return;
    if (this.waitsForUser()) return;
    if (this.link?.socket.readyState === WebSocket.OPEN) return;
    this.retry();
  };

  private request(build: (id: number) => RemoteRequest): Promise<unknown> {
    if (this.status.kind !== 'ready')
      return Promise.reject(new Error('Your laptop is not connected.'));
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.calls.delete(id);
        reject(new Error('Your laptop did not answer in time.'));
      }, CALL_TIMEOUT_MS);
      this.calls.set(id, { resolve, reject, timer });
      this.send(build(id));
    });
  }

  private send(request: RemoteRequest): void {
    this.link?.tunnel?.send(request);
  }

  private setStatus(status: ConnectionStatus): void {
    if (this.disposed && status.kind !== 'error') return;
    this.status = status;
    for (const listener of this.statusListeners) listener(status);
  }

  private async connect(): Promise<void> {
    this.disconnect('Your laptop disconnected.');
    const generation = this.generation;
    this.setStatus(this.attempts > 0 ? { kind: 'offline' } : { kind: 'connecting' });
    try {
      this.device = await prepareDevice(this.handle, this.pin);
      if (generation !== this.generation) return;
      const socket = new WebSocket(relayUrl(this.handle));
      const link: Link = { socket, channel: null, tunnel: null };
      this.link = link;
      this.later(() => {
        if (this.link === link && !link.channel) this.setStatus({ kind: 'offline' });
      }, HANDSHAKE_TIMEOUT_MS);
      let incoming = Promise.resolve();
      socket.onmessage = (event: MessageEvent<unknown>) => {
        const data = event.data;
        if (data === 'pong' || this.link !== link) return;
        if (typeof data !== 'string' || data.length > MAX_RELAY_FRAME_BYTES) {
          socket.close();
          return;
        }
        incoming = incoming
          .then(() => this.receive(link, data))
          .catch((error: unknown) => {
            if (this.link !== link) return;
            this.setStatus({
              kind: 'error',
              message: error instanceof Error ? error.message : 'The secure connection failed.',
            });
            socket.close();
          });
      };
      socket.onclose = () => {
        if (this.link !== link) return;
        this.disconnect('Your laptop disconnected.');
        if (this.disposed || this.waitsForUser()) return;
        if (this.status.kind !== 'error') this.setStatus({ kind: 'offline' });
        const delay = Math.min(30_000, 1_000 * 2 ** Math.min(this.attempts++, 5));
        this.later(() => void this.connect(), delay);
      };
      socket.onerror = () => {
        socket.close();
      };
    } catch (error) {
      if (generation === this.generation)
        this.setStatus({
          kind: 'error',
          message: error instanceof Error ? error.message : 'Unable to start remote access.',
        });
    }
  }

  private async receive(link: Link, data: string): Promise<void> {
    const message: unknown = JSON.parse(data);
    if (!isRecord(message)) throw new Error('Invalid relay message.');
    if (message.type === 'relay-ready') {
      // The socket stays open: the laptop's handshake arrives when it reconnects.
      if (message.laptopOnline === false) this.setStatus({ kind: 'offline' });
      return;
    }
    if (message.type === 'locked') {
      this.setStatus({ kind: 'error', message: 'Unable to connect. Wait a moment and retry.' });
      return;
    }
    if (message.type !== 'forward') throw new Error('Invalid relay response.');
    if (typeof message.deliveryId === 'number')
      link.socket.send(JSON.stringify({ type: 'received', deliveryId: message.deliveryId }));
    this.lastReceivedAt = Date.now();
    if (!link.channel) {
      await this.acceptLaptop(link, message.payload);
      return;
    }
    const frame = await link.channel.decrypt(message.payload);
    if (this.link === link) await link.tunnel?.receive(frame);
  }

  private async acceptLaptop(link: Link, hello: unknown): Promise<void> {
    const accepted = await acceptHostHello(this.handle, this.pin, hello);
    if (this.link !== link) return;
    const channel = accepted.channel;
    link.channel = channel;
    link.socket.send(JSON.stringify({ type: 'forward', payload: accepted.clientHello }));
    link.tunnel = new Tunnel({
      write: async (frame) => {
        const payload = await channel.encrypt(frame);
        if (this.link === link && link.socket.readyState === WebSocket.OPEN)
          link.socket.send(JSON.stringify({ type: 'forward', payload }));
      },
      deliver: (value) => {
        this.handleMessage(remoteMessage(value));
      },
      fail: () => {
        link.socket.close();
      },
      budget: this.budget,
      maxReceiveChars: MAX_LAPTOP_PACKET_CHARS,
    });
    if (this.device && this.device.expiresAt > Date.now()) await this.authenticate();
    else this.setStatus({ kind: 'code', feedback: '' });
  }

  private handleMessage(message: RemoteMessage): void {
    switch (message.type) {
      case 'authorized':
        void this.authorized(message.expiresAt, message.pushPublicKey);
        return;
      case 'pairing':
        this.setStatus({ kind: 'pairing' });
        return;
      case 'locked':
        void this.locked();
        return;
      case 'denied':
        this.setStatus({ kind: 'denied' });
        return;
      case 'removed':
        void this.removed();
        return;
      case 'pong':
        return;
      case 'result': {
        const call = this.calls.get(message.id);
        if (!call) return;
        this.calls.delete(message.id);
        clearTimeout(call.timer);
        if (message.ok) call.resolve(message.value);
        else call.reject(new Error(message.error));
        return;
      }
      case 'event':
        for (const handler of this.listeners.get(message.event) ?? []) handler(message.payload);
        return;
      case 'bridge.opened':
        this.bridges.get(message.socketId)?.opened();
        return;
      case 'bridge.message':
        this.bridges.get(message.socketId)?.received(message.data);
        return;
      case 'bridge.closed':
        this.bridges.get(message.socketId)?.closed(message.code, message.reason);
        return;
      case 'terminal.message':
        this.terminals.get(message.terminalId)?.received(message.message);
        return;
    }
  }

  private async authorized(expiresAt: number, pushPublicKey: string | null): Promise<void> {
    if (!this.device) return;
    this.attempts = 0;
    this.device = { ...this.device, expiresAt };
    await writeDevice(this.device);
    try {
      localStorage.setItem(LAST_HANDLE_KEY, this.handle);
    } catch {
      // Without storage the user opens their remote address directly next time.
    }
    clearInterval(this.heartbeat);
    this.heartbeat = setInterval(() => {
      if (Date.now() - this.lastReceivedAt > SILENCE_LIMIT_MS) this.link?.socket.close();
      else this.send({ type: 'ping' });
    }, HEARTBEAT_MS);
    this.setStatus({ kind: 'ready', pushPublicKey });
  }

  private async locked(): Promise<void> {
    if (!this.device) return;
    this.disconnectChannels('Unlock this browser to continue.');
    this.device = { ...this.device, expiresAt: 0 };
    await writeDevice(this.device);
    this.setStatus({
      kind: 'code',
      feedback: 'Unable to unlock. Check your code or wait before trying again.',
    });
  }

  /** The laptop forgot this browser, so its stored trust must not unlock it again. */
  private async removed(): Promise<void> {
    this.disconnectChannels('This browser was removed.');
    this.setStatus({ kind: 'removed' });
    if (!this.device) return;
    this.device = { ...this.device, expiresAt: 0 };
    await writeDevice(this.device);
  }

  /** A declined or removed browser stays put until the user acts. */
  private waitsForUser(): boolean {
    return this.status.kind === 'denied' || this.status.kind === 'removed';
  }

  private later(callback: () => void, delayMs: number): void {
    this.timers.push(setTimeout(callback, delayMs));
  }

  private disconnect(reason: string): void {
    this.generation++;
    for (const timer of this.timers) clearTimeout(timer);
    this.timers = [];
    clearInterval(this.heartbeat);
    const link = this.link;
    this.link = null;
    link?.tunnel?.close();
    link?.socket.close();
    this.disconnectChannels(reason);
  }

  private disconnectChannels(reason: string): void {
    for (const call of this.calls.values()) {
      clearTimeout(call.timer);
      call.reject(new Error(reason));
    }
    this.calls.clear();
    for (const socket of [...this.bridges.values()]) socket.closed(1006, reason);
    for (const terminal of [...this.terminals.values()]) terminal.disconnected();
  }
}

function relayUrl(handle: string): string {
  const configured: unknown = import.meta.env.VITE_REMOTE_RELAY_URL;
  const url = new URL(
    typeof configured === 'string' && configured.trim() ? configured : DEFAULT_RELAY_URL,
  );
  const local = url.hostname === 'localhost' || url.hostname === '127.0.0.1';
  if (url.protocol !== 'wss:' && !(local && url.protocol === 'ws:'))
    throw new Error('Remote access requires a secure WebSocket relay.');
  if (url.username || url.password || url.search || url.hash)
    throw new Error('Invalid relay configuration.');
  url.pathname = `/v1/handles/${encodeURIComponent(handle)}/socket`;
  return url.href;
}
