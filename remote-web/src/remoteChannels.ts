import { isRecord } from '../../packages/remote/src/index';
import type { RemoteRequest } from '../../packages/remote/src/application';
import type { BridgeSocket, TerminalDataChannel, TerminalEvent } from '../../src/lib/desktop';

type Send = (request: RemoteRequest) => void;

// Matches the desktop preload, which drops larger pastes the same way.
const MAX_TERMINAL_INPUT_BYTES = 32 * 1024;
const encoder = new TextEncoder();

/** A bridge WebSocket whose other end is the laptop's sidecar, reached through the tunnel. */
export class RemoteBridgeSocket implements BridgeSocket {
  readyState: number = WebSocket.CONNECTING;
  onopen: ((event: Event) => void) | null = null;
  onmessage: ((event: MessageEvent) => void) | null = null;
  onclose: ((event: CloseEvent) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;

  constructor(
    private readonly socketId: number,
    private readonly sendRequest: Send,
    private readonly release: () => void,
  ) {}

  send(data: string): void {
    if (this.readyState === WebSocket.OPEN)
      this.sendRequest({ type: 'bridge.send', socketId: this.socketId, data });
  }

  close(): void {
    if (this.readyState === WebSocket.CLOSING || this.readyState === WebSocket.CLOSED) return;
    this.readyState = WebSocket.CLOSING;
    this.sendRequest({ type: 'bridge.close', socketId: this.socketId });
  }

  opened(): void {
    if (this.readyState !== WebSocket.CONNECTING) return;
    this.readyState = WebSocket.OPEN;
    this.onopen?.(new Event('open'));
  }

  received(data: string): void {
    if (this.readyState === WebSocket.OPEN) this.onmessage?.(new MessageEvent('message', { data }));
  }

  closed(code: number, reason: string): void {
    if (this.readyState === WebSocket.CLOSED) return;
    this.readyState = WebSocket.CLOSED;
    this.release();
    this.onclose?.(new CloseEvent('close', { code, reason, wasClean: code === 1000 }));
  }
}

/** A terminal's data port on the laptop, reached through the tunnel. */
export class RemoteTerminalChannel implements TerminalDataChannel {
  private handler: ((event: TerminalEvent) => void) | null = null;
  private queued: TerminalEvent[] = [];
  private isClosed = false;

  constructor(
    private readonly terminalId: string,
    private readonly sendRequest: Send,
    private readonly release: () => void,
  ) {}

  postInput(data: string): void {
    if (this.isClosed || !data || encoder.encode(data).length > MAX_TERMINAL_INPUT_BYTES) return;
    this.post({ type: 'input', data });
  }

  onEvent(handler: (event: TerminalEvent) => void): () => void {
    this.handler = handler;
    for (const event of this.queued.splice(0)) handler(event);
    return () => {
      if (this.handler === handler) this.handler = null;
    };
  }

  close(): void {
    if (this.isClosed) return;
    this.isClosed = true;
    this.handler = null;
    this.queued = [];
    this.release();
    this.sendRequest({ type: 'terminal.close', terminalId: this.terminalId });
  }

  received(message: unknown): void {
    const event = terminalEvent(message);
    if (this.isClosed || !event) return;
    // The laptop paces a terminal's output by these acknowledgements.
    if (event.kind === 'data' || event.kind === 'replay')
      this.post({
        type: 'ack',
        bytes: encoder.encode(event.data).length,
        byteOffset: event.byteOffset,
      });
    this.deliver(event);
  }

  disconnected(): void {
    if (this.isClosed) return;
    this.deliver({ kind: 'error', message: 'Your laptop disconnected. Reopen this terminal.' });
    this.isClosed = true;
    this.release();
  }

  private deliver(event: TerminalEvent): void {
    if (this.handler) this.handler(event);
    else this.queued.push(event);
  }

  private post(message: unknown): void {
    this.sendRequest({ type: 'terminal.post', terminalId: this.terminalId, message });
  }
}

// The laptop's terminal registry builds these events; only their shape is checked here.
function terminalEvent(value: unknown): TerminalEvent | null {
  if (!isRecord(value)) return null;
  switch (value.kind) {
    case 'data':
    case 'replay':
      if (typeof value.data !== 'string' || typeof value.byteOffset !== 'number') return null;
      return value as TerminalEvent;
    case 'exit':
      return value as TerminalEvent;
    case 'error':
      return typeof value.message === 'string' ? { kind: 'error', message: value.message } : null;
    default:
      return null;
  }
}
