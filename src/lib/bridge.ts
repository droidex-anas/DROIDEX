import { getBridgeInfo } from './desktop';
import { noteBridgeEventReceived } from './rendererPerf';
import { setTransportHealth } from './runtimeHealth';
import type * as bridgeWireValidation from './bridgeWireValidation';
import {
  BRIDGE_PROTOCOL_VERSION,
  type BridgeResetMessage,
  type BridgeSnapshotMessage,
  type ClientCommand,
  type ServerEvent,
  type ServerEventBatch,
} from '../types/bridge';

type Listener = (event: ServerEvent) => void;
// `fromSnapshot` marks the events a fresh stream starts from: what the last
// stream said may no longer hold.
type BatchListener = (events: readonly ServerEvent[], fromSnapshot: boolean) => void;
// Which chats the new sidecar answered for, and which requests went to it.
type RuntimeReplacedListener = (
  liveAppSessionIds: ReadonlySet<string>,
  resentRequestIds: ReadonlySet<string>,
) => void;
type ReconnectScheduler = (callback: () => void, delayMs: number) => void;
type WireValidation = typeof bridgeWireValidation;

interface TurnBaselineAdopter {
  gitAdoptTurnBaseline: (dir: string, clientRef: string, appSessionId: string) => Promise<unknown>;
}

function canAdoptTurnBaseline(api: object): api is TurnBaselineAdopter {
  return 'gitAdoptTurnBaseline' in api && typeof api.gitAdoptTurnBaseline === 'function';
}

export class Bridge {
  private readonly pageId = crypto.randomUUID();
  private ws: WebSocket | null = null;
  private readonly listeners = new Set<Listener>();
  private readonly batchListeners = new Set<BatchListener>();
  private readonly runtimeReplacedListeners = new Set<RuntimeReplacedListener>();
  private queue: ClientCommand[] = [];
  // Requests sent on the socket now open, before its first answer: they reach
  // the sidecar that answers this connection, whichever one that is.
  private sentRequestIds: Set<string> | null = null;
  private backoff = 500;
  private url = '';
  private started = false;
  private lastGeneration: string | null = null;
  private lastSeq = 0;
  private wireValidation: WireValidation | null = null;
  private firstCommand: () => ClientCommand | null = () => null;

  constructor(
    private readonly loadBridgeInfo = getBridgeInfo,
    private readonly schedule: ReconnectScheduler = (callback, delayMs) => {
      setTimeout(callback, delayMs);
    },
    private readonly loadWireValidation = () => import('./bridgeWireValidation'),
  ) {}

  async start(): Promise<void> {
    if (this.started) return;
    this.started = true;
    await this.connect();
  }

  private async connect(): Promise<void> {
    let port: number;
    let token: string;
    try {
      if (this.wireValidation === null) {
        const [bridgeInfo, wireValidation] = await Promise.all([
          this.loadBridgeInfo(),
          this.loadWireValidation(),
        ]);
        ({ port, token } = bridgeInfo);
        this.wireValidation = wireValidation;
      } else {
        ({ port, token } = await this.loadBridgeInfo());
      }
    } catch {
      this.scheduleReconnect();
      return;
    }
    this.url = `ws://127.0.0.1:${String(port)}${token ? `?token=${token}` : ''}`;
    this.open(this.wireValidation);
  }

  private open(wireValidation: WireValidation): void {
    let ws: WebSocket;
    try {
      ws = new WebSocket(this.connectionUrl());
    } catch {
      this.scheduleReconnect();
      return;
    }
    this.ws = ws;
    ws.onopen = () => {
      if (this.ws !== ws) return;
      this.backoff = 500;
      setTransportHealth('connected');
      const first = this.firstCommand();
      const pending = first ? [first, ...this.queue] : this.queue;
      this.queue = [];
      this.sentRequestIds = new Set();
      pending.forEach((command) => {
        this.sendOpen(ws, command);
      });
    };
    ws.onmessage = (message) => {
      if (this.ws !== ws || typeof message.data !== 'string') return;
      let parsed: unknown;
      try {
        parsed = JSON.parse(message.data);
      } catch {
        return;
      }
      const wireMessage = wireValidation.serverWireMessage(parsed);
      if (wireMessage === null) {
        if (isRecord(parsed) && parsed.type === 'events.batch') {
          this.handleMalformedBatch(ws);
        }
        return;
      }
      if (wireMessage.type === 'events.batch') this.receiveBatch(wireMessage, wireValidation);
      else if (wireMessage.type === 'bridge.reset') this.receiveReset(wireMessage);
      else if (wireMessage.type === 'bridge.snapshot') this.receiveSnapshot(wireMessage);
      else this.publishEvents([wireMessage]);
      // The sidecar has answered this socket: a replacement can only show up on
      // a later one.
      this.sentRequestIds = null;
    };
    ws.onclose = () => {
      if (this.ws !== ws) return;
      this.ws = null;
      setTransportHealth('disconnected');
      this.scheduleReconnect();
    };
    ws.onerror = () => {
      if (this.ws === ws) ws.close();
    };
  }

  private receiveBatch(batch: ServerEventBatch, wireValidation: WireValidation): void {
    if (this.lastGeneration !== null && this.lastGeneration !== batch.generation) {
      this.lastGeneration = batch.generation;
      this.lastSeq = 0;
    }
    this.lastGeneration ??= batch.generation;
    if (batch.lastSeq <= this.lastSeq) return;
    if (batch.firstSeq > this.lastSeq + 1 && this.lastSeq !== 0) {
      this.ws?.close(4012, 'bridge event sequence gap');
      return;
    }

    const events: ServerEvent[] = [];
    for (const { seq, event } of batch.events) {
      if (seq <= this.lastSeq) continue;
      // The envelope was checked as a whole; each event is checked on its own,
      // so one bad event no longer costs the rest of the batch.
      const wire: unknown = event;
      if (!wireValidation.isServerEvent(wire)) {
        console.warn('Dropped bridge event: isServerEvent check failed', {
          type: isRecord(wire) && typeof wire.type === 'string' ? wire.type : '<unknown>',
          seq,
        });
        continue;
      }
      events.push(wire);
    }
    if (events.length > 0) this.publishEvents(events);
    this.lastGeneration = batch.generation;
    this.lastSeq = batch.lastSeq;
  }

  private receiveReset(message: BridgeResetMessage): void {
    this.lastGeneration = message.generation;
    this.lastSeq = message.lastSeq;
    this.publishEvents([
      {
        type: 'error',
        code: 'bridge.resync_required',
        message: 'The renderer sent an invalid event resume cursor and started a fresh stream.',
        recoverable: false,
      },
    ]);
  }

  private receiveSnapshot(message: BridgeSnapshotMessage): void {
    this.lastGeneration = message.generation;
    this.lastSeq = message.lastSeq;
    if (message.reason === 'generation_changed') {
      const live = new Set(message.snapshot.sessions.map((session) => session.appSessionId));
      const sent = this.sentRequestIds ?? new Set<string>();
      for (const listener of this.runtimeReplacedListeners) listener(live, sent);
    }
    this.publishEvents(eventsFromSnapshot(message), true);
  }

  private handleMalformedBatch(ws: WebSocket): void {
    this.lastGeneration = null;
    this.lastSeq = 0;
    this.publishEvents([
      {
        type: 'error',
        code: 'bridge.resync_required',
        message:
          'The agent runtime sent a malformed event batch. Reconnecting with a fresh cursor.',
        recoverable: true,
      },
    ]);
    ws.close(4002, 'malformed bridge message');
  }

  private publishEvents(events: readonly ServerEvent[], fromSnapshot = false): void {
    for (const event of events) {
      noteBridgeEventReceived(event);
      this.adoptTurnBaseline(event);
      for (const listener of this.listeners) listener(event);
    }
    for (const listener of this.batchListeners) listener(events, fromSnapshot);
  }

  private adoptTurnBaseline(event: ServerEvent): void {
    if (event.type !== 'session.created' || !event.session.cwd) return;
    const api = globalThis.window.droidControl;
    if (!api || !canAdoptTurnBaseline(api)) return;
    void api
      .gitAdoptTurnBaseline(event.session.cwd, event.clientRef, event.session.appSessionId)
      .catch(() => {
        // Best effort: Review falls back to HEAD when no baseline exists.
      });
  }

  private connectionUrl(): string {
    const params = new URLSearchParams({
      bridgeProtocol: String(BRIDGE_PROTOCOL_VERSION),
      pageId: this.pageId,
    });
    if (this.lastGeneration !== null) {
      params.set('resumeGeneration', this.lastGeneration);
      params.set('resumeSeq', String(this.lastSeq));
    }
    return `${this.url}${this.url.includes('?') ? '&' : '?'}${params.toString()}`;
  }

  private scheduleReconnect(): void {
    this.schedule(() => void this.connect(), this.backoff);
    this.backoff = Math.min(this.backoff * 2, 5_000);
  }

  /** Sets a command every new connection sends ahead of anything queued. */
  sendFirstOnOpen(build: () => ClientCommand | null): void {
    this.firstCommand = build;
  }

  send(command: ClientCommand): void {
    if (this.ws?.readyState === WebSocket.OPEN) this.sendOpen(this.ws, command);
    else this.queue.push(command);
  }

  private sendOpen(ws: WebSocket, command: ClientCommand): void {
    if ('requestId' in command && typeof command.requestId === 'string')
      this.sentRequestIds?.add(command.requestId);
    ws.send(JSON.stringify(command));
  }

  sendIfConnected(command: ClientCommand): boolean {
    if (this.ws?.readyState !== WebSocket.OPEN) return false;
    this.ws.send(JSON.stringify(command));
    return true;
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  subscribeBatch(listener: BatchListener): () => void {
    this.batchListeners.add(listener);
    return () => this.batchListeners.delete(listener);
  }

  // Called just before the events of a snapshot from a replaced sidecar. What
  // the old process was still working on will never be answered; a command
  // queued while the socket was down goes to the new one and is answered there.
  subscribeRuntimeReplaced(listener: RuntimeReplacedListener): () => void {
    this.runtimeReplacedListeners.add(listener);
    return () => this.runtimeReplacedListeners.delete(listener);
  }
}

function eventsFromSnapshot(message: BridgeSnapshotMessage): ServerEvent[] {
  const events: ServerEvent[] = [
    {
      type: 'connection',
      status: 'connected',
    },
    {
      type: 'runtime.updated',
      status: message.snapshot.runtime,
    },
    {
      type: 'sessions.processes',
      processes: message.snapshot.processes,
    },
  ];
  // A new sidecar starts with healthy storage until it reports otherwise; a
  // replay gap from the same sidecar keeps whatever it already reported.
  if (message.reason === 'generation_changed')
    events.push({ type: 'history.persistenceRecovered' });
  const unavailableReason = message.snapshot.persistence.unavailableReason;
  if (unavailableReason !== undefined) {
    events.push({
      type: 'error',
      code: 'history.unavailable',
      message: `Canonical history could not open: ${unavailableReason} History reads and writes are disabled. Quit DROIDEX, repair storage or restore a backup, then restart. Do not delete the canonical database.`,
      recoverable: false,
    });
  }
  const searchUnavailableReason = message.snapshot.persistence.searchUnavailableReason;
  if (searchUnavailableReason !== undefined) {
    events.push({
      type: 'error',
      code: 'history.search_unavailable',
      message: `History search is unavailable: ${searchUnavailableReason} Canonical session history is unaffected.`,
      recoverable: false,
    });
  }
  for (const session of message.snapshot.sessions) {
    events.push({ type: 'session.updated', session });
  }
  for (const child of message.snapshot.children) {
    events.push({
      type: 'session.child',
      event: 'upserted',
      child,
      runtimeAvailable: false,
      runtimeGeneration: 0,
    });
  }
  for (const interrupted of message.snapshot.interrupted) {
    events.push({
      type: 'error',
      code: 'session.interrupted',
      appSessionId: interrupted.appSessionId,
      message: interrupted.reason,
      recoverable: true,
    });
  }
  if (message.snapshot.persistence.hadUnflushedWork) {
    events.push({
      type: 'error',
      code: 'history.unflushed_work',
      message:
        message.snapshot.persistence.message ??
        'The previous agent runtime exited with unflushed history. Restored sessions use the last durable snapshot.',
      recoverable: true,
    });
  }
  return events;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

export const bridge = new Bridge();
