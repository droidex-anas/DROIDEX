import WebSocket, { type RawData } from 'ws';
import {
  isRemoteDesktopMethod,
  REMOTE_DESKTOP_EVENTS,
  toWire,
  type RemoteDesktopEvent,
  type RemoteDesktopMethod,
  type RemoteMessage,
  type RemoteRequest,
} from '../../../packages/remote/src/application.js';
import { rawText } from './relayConnection.js';

/** The laptop's desktop API, as the Electron main process lends it to one browser. */
export interface RemoteDesktop {
  open(peerId: string): void;
  close(peerId: string): void;
  call(peerId: string, method: RemoteDesktopMethod, args: unknown[]): unknown;
  listen(
    peerId: string,
    event: RemoteDesktopEvent,
    handler: (payload: unknown) => void,
  ): () => void;
  openTerminal(
    peerId: string,
    terminalId: string,
    onMessage: (message: unknown) => void,
  ): RemoteTerminal;
}

interface RemoteTerminal {
  post(message: unknown): void;
  close(): void;
}

export type PeerSessionRequest = Extract<
  RemoteRequest,
  { type: `bridge.${string}` | `terminal.${string}` | 'call' }
>;

const MAX_BRIDGE_SOCKETS = 4;
const MAX_TERMINALS = 16;
const MAX_CALLS = 64;
// Stop reading the local bridge while this much waits for the relay, so a
// large replay cannot outgrow the tunnel's queue.
const PAUSE_ABOVE_QUEUED_CHARS = 8 * 1024 * 1024;
const BRIDGE_PARAMS = ['bridgeProtocol', 'pageId', 'resumeGeneration', 'resumeSeq'];

interface BridgeSocket {
  socket: WebSocket | null;
}

/**
 * Everything one authorized browser has open on the laptop: its bridge
 * sockets to the local sidecar, its terminals, its desktop event listeners,
 * and its in-flight desktop calls. Closing the session releases all of them.
 */
export class PeerSession {
  private readonly sockets = new Map<number, BridgeSocket>();
  private readonly terminals = new Map<string, RemoteTerminal>();
  private readonly unlisten: (() => void)[] = [];
  private calls = 0;
  private closed = false;

  constructor(
    private readonly options: {
      peerId: string;
      desktop: RemoteDesktop;
      bridgeInfo: () => Promise<{ port: number; token: string }>;
      send: (message: RemoteMessage) => void;
      queuedChars: () => number;
    },
  ) {
    options.desktop.open(options.peerId);
    for (const event of REMOTE_DESKTOP_EVENTS) {
      this.unlisten.push(
        options.desktop.listen(options.peerId, event, (payload) => {
          this.send({ type: 'event', event, payload });
        }),
      );
    }
  }

  handle(request: PeerSessionRequest): void {
    if (this.closed) return;
    switch (request.type) {
      case 'call':
        this.call(request.id, request.method, request.args);
        return;
      case 'bridge.open':
        void this.openBridge(request.socketId, request.params);
        return;
      case 'bridge.send': {
        const socket = this.sockets.get(request.socketId)?.socket;
        if (socket?.readyState === WebSocket.OPEN) socket.send(request.data);
        return;
      }
      case 'bridge.close': {
        const bridge = this.sockets.get(request.socketId);
        if (bridge?.socket) bridge.socket.close();
        else if (bridge) {
          this.sockets.delete(request.socketId);
          this.send({ type: 'bridge.closed', socketId: request.socketId, code: 1000, reason: '' });
        }
        return;
      }
      case 'terminal.open':
        this.openTerminal(request.terminalId);
        return;
      case 'terminal.post':
        this.terminals.get(request.terminalId)?.post(request.message);
        return;
      case 'terminal.close':
        this.terminals.get(request.terminalId)?.close();
        this.terminals.delete(request.terminalId);
        return;
    }
  }

  /** The tunnel has caught up; read the local bridge again. */
  resume(): void {
    for (const { socket } of this.sockets.values()) socket?.resume();
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    for (const stop of this.unlisten) stop();
    for (const { socket } of this.sockets.values()) socket?.terminate();
    for (const terminal of this.terminals.values()) terminal.close();
    this.sockets.clear();
    this.terminals.clear();
    this.options.desktop.close(this.options.peerId);
  }

  private send(message: RemoteMessage): void {
    if (!this.closed) this.options.send(message);
  }

  private call(id: number, method: string, args: unknown[]): void {
    if (!isRemoteDesktopMethod(method)) {
      this.send({
        type: 'result',
        id,
        ok: false,
        error: 'Update DROIDEX on your laptop to use this',
      });
      return;
    }
    if (this.calls >= MAX_CALLS) {
      this.send({ type: 'result', id, ok: false, error: 'Too many requests are still running' });
      return;
    }
    this.calls++;
    void (async () => {
      try {
        const value: unknown = await this.options.desktop.call(this.options.peerId, method, args);
        this.send({ type: 'result', id, ok: true, value: toWire(value) });
      } catch (error) {
        const message = error instanceof Error ? error.message : 'The laptop could not do that';
        this.send({ type: 'result', id, ok: false, error: message });
      } finally {
        this.calls--;
      }
    })();
  }

  private async openBridge(socketId: number, params: string): Promise<void> {
    if (this.sockets.has(socketId) || this.sockets.size >= MAX_BRIDGE_SOCKETS) {
      this.send({ type: 'bridge.closed', socketId, code: 1013, reason: 'Too many connections' });
      return;
    }
    // The reservation also identifies this open if its ID is canceled and reused.
    const bridge: BridgeSocket = { socket: null };
    this.sockets.set(socketId, bridge);
    try {
      const info = await this.options.bridgeInfo();
      if (this.sockets.get(socketId) !== bridge) return;
      const url = new URL(`ws://127.0.0.1:${String(info.port)}`);
      if (info.token) url.searchParams.set('token', info.token);
      const requested = new URLSearchParams(params);
      for (const key of BRIDGE_PARAMS) {
        const value = requested.get(key);
        if (value !== null) url.searchParams.set(key, value);
      }
      const socket = new WebSocket(url, { handshakeTimeout: 8000 });
      bridge.socket = socket;
      socket.on('open', () => {
        this.send({ type: 'bridge.opened', socketId });
      });
      socket.on('message', (raw: RawData) => {
        this.send({ type: 'bridge.message', socketId, data: rawText(raw) });
        if (this.options.queuedChars() > PAUSE_ABOVE_QUEUED_CHARS) socket.pause();
      });
      socket.on('error', () => {
        socket.terminate();
      });
      socket.on('close', (code: number, reason: Buffer) => {
        if (this.sockets.get(socketId) !== bridge) return;
        this.sockets.delete(socketId);
        this.send({ type: 'bridge.closed', socketId, code, reason: reason.toString('utf8') });
      });
    } catch {
      if (this.sockets.get(socketId) !== bridge) return;
      this.sockets.delete(socketId);
      this.send({ type: 'bridge.closed', socketId, code: 1011, reason: 'Agent runtime offline' });
    }
  }

  private openTerminal(terminalId: string): void {
    this.terminals.get(terminalId)?.close();
    this.terminals.delete(terminalId);
    if (this.terminals.size >= MAX_TERMINALS) {
      this.send({
        type: 'terminal.message',
        terminalId,
        message: { kind: 'error', message: 'Too many terminals are open' },
      });
      return;
    }
    const terminal = this.options.desktop.openTerminal(
      this.options.peerId,
      terminalId,
      (message) => {
        this.send({ type: 'terminal.message', terminalId, message });
      },
    );
    this.terminals.set(terminalId, terminal);
  }
}
