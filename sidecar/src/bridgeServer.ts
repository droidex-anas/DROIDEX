// The sidecar's single outbound surface: authenticated WebSocket fan-out,
// ordered event batching/replay, and token-gated HTTP routes. The packaged
// entry and perf harness both use this exact transport path.

import { WebSocketServer, type RawData, type WebSocket } from 'ws';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';

import { assertValidInteractionResponse } from './interactionResponses.js';
import { assertValidResponseFormat } from './appPrompt.js';
import { assertValidMentions } from './providers/catalog.js';
import { BridgeEventBatcher, type BridgeEventBatchMetadata } from './bridgeEventBatcher.js';
import { BridgeReplayBuffer, type SerializedEventBatch } from './bridgeReplayBuffer.js';
import {
  BRIDGE_PROTOCOL_VERSION,
  type BridgeResetMessage,
  type BridgeRuntimeSnapshot,
  type BridgeSnapshotMessage,
  type ClientCommand,
  type ServerEvent,
  type ServerEventBatch,
  type ServerWireMessage,
} from './protocol.js';
import { providerKind } from './providers/providerKind.js';
import { emptyRuntimeSnapshot } from './runtimeSnapshot.js';
import { hotPathMetrics } from './telemetry/hotPathMetrics.js';
import { VoiceConnectionOwners } from './voiceConnectionOwners.js';

const HOST = '127.0.0.1';
const SOFT_CLIENT_BUFFER_BYTES = 512 * 1024;
const HARD_CLIENT_BUFFER_BYTES = 8 * 1024 * 1024;
const CLIENT_CLOSE_DRAIN_MS = 250;
// Commands a client may send before it is caught up and let in, by count and
// by size.
const MAX_EARLY_COMMANDS = 256;
const MAX_EARLY_BYTES = 8 * 1024 * 1024;

export interface BridgeServer {
  readonly port: number;
  readonly ready: Promise<void>;
  broadcast(event: ServerEvent): void;
  close(): Promise<void>;
}

export function startBridgeServer(options: {
  requestedPort: number;
  token: string;
  onCommand: (command: ClientCommand) => Promise<void>;
  getSnapshot?: () => Promise<BridgeRuntimeSnapshot> | BridgeRuntimeSnapshot;
}): BridgeServer {
  const clients = new Set<WebSocket>();
  const voiceOwners = new VoiceConnectionOwners((appSessionId) => {
    void options
      .onCommand({ type: 'voice.stop', appSessionId })
      .then(() => {
        broadcast({ type: 'voice.state', appSessionId, status: 'closed' });
      })
      .catch((error: unknown) => {
        console.error('Orphaned voice session could not be stopped:', error);
      });
  });
  const replay = new BridgeReplayBuffer();
  let boundPort = options.requestedPort;
  let closed = false;
  let closePromise: Promise<void> | null = null;

  const server = createServer((req, res) => {
    if (serveHotPathMetrics(req, res, options.token)) return;
    if (serveHealth(req, res, options.token)) return;
    res.writeHead(404).end('not found');
  });

  const wss = new WebSocketServer({ server });
  const batcher = new BridgeEventBatcher({
    isUnderPressure: () => maxBufferedAmount(clients) >= SOFT_CLIENT_BUFFER_BYTES,
    sendBatch,
    onQueueChanged: (snapshot) => {
      hotPathMetrics.recordTransportQueue({
        pendingEvents: snapshot.pendingLogicalEvents,
        pendingEstimatedBytes: snapshot.pendingEstimatedBytes,
        oldestPendingAgeMs: snapshot.oldestPendingAgeMs,
      });
    },
  });

  function broadcast(event: ServerEvent): void {
    if (closed) return;
    batcher.enqueue(event);
  }

  function sendBatch(
    batch: ServerEventBatch,
    metadata: BridgeEventBatchMetadata,
    batchData: string,
  ): void {
    const startedAt = performance.now();
    const replayEntry = replay.push(batch, batchData);
    if (replayEntry.bytes >= HARD_CLIENT_BUFFER_BYTES) replay.markHistoryUnavailable();
    let bytesSent = 0;
    let sendOperations = 0;
    let maxBufferedBytes = 0;

    for (const ws of clients) {
      if (ws.readyState !== ws.OPEN) continue;
      maxBufferedBytes = Math.max(maxBufferedBytes, ws.bufferedAmount);
      if (disconnectIfBackpressured(ws, replayEntry.bytes)) continue;
      ws.send(batchData);
      bytesSent += replayEntry.bytes;
      sendOperations += 1;
    }

    hotPathMetrics.recordTransport(performance.now() - startedAt, bytesSent, sendOperations);
    hotPathMetrics.recordTransportBatch({
      logicalEvents: metadata.logicalEvents,
      deliveredEvents: metadata.deliveredEvents,
      bytes: replayEntry.bytes,
      queueDelayMs: metadata.queueDelayMs,
      immediate: metadata.immediate,
    });
    hotPathMetrics.recordClientBufferedAmount(maxBufferedBytes);
    const replayState = replay.snapshot();
    hotPathMetrics.recordReplayBuffer(replayState.batches, replayState.bytes);
  }

  const ready = new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(options.requestedPort, HOST, () => {
      const address = server.address();
      if (!address || typeof address === 'string') {
        reject(new Error('Sidecar bridge did not expose a TCP address.'));
        return;
      }
      boundPort = address.port;
      resolve();
    });
  });

  wss.on('connection', (ws, req) => {
    const url = new URL(req.url ?? '', `http://${HOST}`);
    if (url.searchParams.get('token') !== options.token) {
      ws.close(1008, 'unauthorized');
      return;
    }

    if (url.searchParams.get('bridgeProtocol') !== String(BRIDGE_PROTOCOL_VERSION)) {
      ws.close(1002, 'unsupported bridge protocol');
      return;
    }
    void admitClient(ws, url);
  });

  async function admitClient(ws: WebSocket, url: URL): Promise<void> {
    const pageId = url.searchParams.get('pageId');
    // Commands sent while the client is caught up (the app sends its first ones
    // the moment the socket opens) wait here and run in order once it is in.
    let early: RawData[] | null = [];
    const disconnect = () => {
      early = null;
      clients.delete(ws);
      voiceOwners.disconnected(ws);
    };
    ws.on('close', disconnect);
    ws.on('error', disconnect);
    if (pageId) voiceOwners.connected(pageId, ws);
    let inside = false;
    let earlyBytes = 0;
    ws.on('message', (raw) => {
      if (inside) {
        void handleMessage(ws, raw, pageId);
        return;
      }
      if (!early) return;
      // A client that keeps sending while it is not yet in is cut off; it
      // reconnects and sends its first commands again.
      earlyBytes += rawSize(raw);
      if (early.length >= MAX_EARLY_COMMANDS || earlyBytes > MAX_EARLY_BYTES) {
        early = null;
        ws.close(1008, 'too many commands before ready');
      } else early.push(raw);
    });
    const admitted = await resumeClient(ws, url);
    if (!admitted || ws.readyState !== ws.OPEN) {
      early = null;
      return;
    }
    clients.add(ws);
    const waiting = early;
    early = null;
    inside = true;
    for (const raw of waiting) void handleMessage(ws, raw, pageId);
  }

  async function resumeClient(ws: WebSocket, url: URL): Promise<boolean> {
    const resumeGeneration = url.searchParams.get('resumeGeneration');
    const resumeSeqValue = url.searchParams.get('resumeSeq');
    if (resumeGeneration === null && resumeSeqValue === null) return true;

    // A reset/replay cursor must never acknowledge logical events that are
    // still sitting in the timer window. Flush before taking the cursor so
    // every acknowledged sequence is either replayable or explicitly outside
    // the retained window.
    batcher.flush();
    const current = batcher.snapshot();
    const resumeSeq = nonNegativeInteger(resumeSeqValue);
    if (resumeGeneration === null || resumeSeq === null) {
      sendReset(ws, current.lastSeq, 'invalid_resume');
      return true;
    }

    if (resumeGeneration !== batcher.generation) {
      return sendSnapshotThenCatchUp(ws, current.lastSeq, 'generation_changed');
    }
    if (resumeSeq > current.lastSeq) {
      sendReset(ws, current.lastSeq, 'invalid_resume');
      return true;
    }

    const missed = replay.replayAfter(resumeSeq);
    if (missed === null) {
      return sendSnapshotThenCatchUp(ws, current.lastSeq, 'replay_unavailable');
    }
    return replayBatches(ws, missed);
  }

  async function sendSnapshotThenCatchUp(
    ws: WebSocket,
    cursor: number,
    reason: BridgeSnapshotMessage['reason'],
  ): Promise<boolean> {
    await sendSnapshot(ws, cursor, reason);
    if (ws.readyState !== ws.OPEN) return false;
    batcher.flush();
    const missed = replay.replayAfter(cursor);
    if (missed === null || missed.length === 0) return true;
    return replayBatches(ws, missed);
  }

  function replayBatches(ws: WebSocket, missed: readonly SerializedEventBatch[]): boolean {
    const startedAt = performance.now();
    let replayedBytes = 0;
    let replayedEvents = 0;
    let sendOperations = 0;
    for (const entry of missed) {
      if (disconnectIfBackpressured(ws, entry.bytes)) return false;
      ws.send(entry.data);
      replayedBytes += entry.bytes;
      replayedEvents += entry.eventCount;
      sendOperations += 1;
    }
    if (missed.length > 0) {
      hotPathMetrics.recordTransport(performance.now() - startedAt, replayedBytes, sendOperations);
      hotPathMetrics.recordReplay(missed.length, replayedEvents, replayedBytes);
    }
    return true;
  }

  function sendReset(ws: WebSocket, lastSeq: number, reason: BridgeResetMessage['reason']): void {
    sendDirectWire(ws, {
      type: 'bridge.reset',
      generation: batcher.generation,
      lastSeq,
      reason,
    });
  }

  async function sendSnapshot(
    ws: WebSocket,
    lastSeq: number,
    reason: BridgeSnapshotMessage['reason'],
  ): Promise<void> {
    let snapshot: BridgeRuntimeSnapshot;
    try {
      snapshot = (await options.getSnapshot?.()) ?? emptyRuntimeSnapshot();
    } catch (error) {
      console.error('Bridge snapshot failed:', error);
      snapshot = emptyRuntimeSnapshot();
    }
    sendDirectWire(ws, {
      type: 'bridge.snapshot',
      generation: batcher.generation,
      lastSeq,
      reason,
      snapshot,
    });
  }

  async function handleMessage(ws: WebSocket, raw: RawData, pageId: string | null): Promise<void> {
    let parsed: unknown;
    try {
      parsed = JSON.parse(messageText(raw));
    } catch {
      sendDirectWire(ws, { type: 'error', message: 'Invalid JSON command' });
      return;
    }
    try {
      if (typeof parsed === 'object' && parsed !== null) {
        if ('responseFormat' in parsed) assertValidResponseFormat(parsed.responseFormat);
        if ('mentions' in parsed) assertValidMentions(parsed);
        assertValidSteerId(parsed);
        assertValidInteractionResponse(parsed);
        assertValidChatPreferences(parsed);
        assertValidUsageRefresh(parsed);
      }
      const command = parsed as ClientCommand;
      if (command.type === 'voice.start' || command.type === 'voice.stop')
        await runVoiceCommand(command, pageId);
      else await options.onCommand(command);
    } catch (err) {
      sendDirectWire(ws, {
        type: 'error',
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }

  // The page that started a call owns it: only a start that succeeds moves
  // ownership, and only the owning page can stop it.
  async function runVoiceCommand(
    command: Extract<ClientCommand, { type: 'voice.start' | 'voice.stop' }>,
    pageId: string | null,
  ): Promise<void> {
    if (command.type === 'voice.stop') {
      if (voiceOwners.stopped(command.appSessionId, pageId ?? '')) await options.onCommand(command);
      return;
    }
    if (!pageId) throw new Error('Voice requires a renderer page ID. Reload DROIDEX.');
    const { appSessionId, attempt } = command;
    voiceOwners.startBegan(appSessionId, pageId, attempt);
    // A failed start has already been reported to its chat by the voice owner;
    // here it only means this page does not take the call.
    const started = await options.onCommand(command).then(
      () => true,
      () => false,
    );
    if (started) voiceOwners.startSucceeded(appSessionId, attempt);
    else voiceOwners.startFailed(appSessionId, attempt);
  }

  function sendDirectWire(ws: WebSocket, message: ServerWireMessage): void {
    if (ws.readyState !== ws.OPEN) return;
    const startedAt = performance.now();
    const data = JSON.stringify(message);
    const payloadBytes = Buffer.byteLength(data);
    if (disconnectIfBackpressured(ws, payloadBytes)) return;
    ws.send(data);
    hotPathMetrics.recordTransport(performance.now() - startedAt, payloadBytes, 1);
  }

  function disconnectIfBackpressured(ws: WebSocket, payloadBytes: number): boolean {
    const projectedBufferedBytes = ws.bufferedAmount + payloadBytes;
    hotPathMetrics.recordClientBufferedAmount(projectedBufferedBytes);
    if (projectedBufferedBytes < HARD_CLIENT_BUFFER_BYTES) return false;
    clients.delete(ws);
    hotPathMetrics.recordBackpressureDisconnect(projectedBufferedBytes);
    ws.terminate();
    return true;
  }

  function messageText(raw: RawData): string {
    if (Buffer.isBuffer(raw)) return raw.toString('utf8');
    if (raw instanceof ArrayBuffer) return Buffer.from(raw).toString('utf8');
    return Buffer.concat(raw).toString('utf8');
  }

  function serveHealth(req: IncomingMessage, res: ServerResponse, token: string): boolean {
    const url = new URL(req.url ?? '/', `http://${HOST}:${String(boundPort)}`);
    if (url.pathname !== '/health') return false;
    if (req.method !== 'GET') {
      res.writeHead(405).end('method not allowed');
      return true;
    }
    if (url.searchParams.get('token') !== token) {
      res.writeHead(401).end('unauthorized');
      return true;
    }
    const queue = batcher.snapshot();
    res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' });
    res.end(
      JSON.stringify({
        ok: true,
        generation: queue.generation,
        lastSeq: queue.lastSeq,
        eventLoopDelayMs: hotPathMetrics.snapshot().eventLoop?.meanMs ?? 0,
      }),
    );
    return true;
  }

  function serveHotPathMetrics(req: IncomingMessage, res: ServerResponse, token: string): boolean {
    const url = new URL(req.url ?? '/', `http://${HOST}:${String(boundPort)}`);
    if (url.pathname !== '/perf/metrics') return false;
    if (req.method !== 'GET') {
      res.writeHead(405).end('method not allowed');
      return true;
    }
    if (url.searchParams.get('token') !== token) {
      res.writeHead(401).end('unauthorized');
      return true;
    }
    // Production idle never arms the 10 ms sampler. Support can opt in for
    // the rest of this process: GET /perf/metrics?token=…&eventLoop=1
    if (url.searchParams.get('eventLoop') === '1') {
      hotPathMetrics.enableEventLoop();
    }
    res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' });
    res.end(JSON.stringify(hotPathMetrics.snapshot()));
    return true;
  }

  function close(): Promise<void> {
    if (closePromise) return closePromise;
    closed = true;
    batcher.close();
    voiceOwners.close();
    closePromise = new Promise<void>((resolve) => {
      let pendingServers = 2;
      const settled = () => {
        pendingServers -= 1;
        if (pendingServers === 0) resolve();
      };
      const forceClose = setTimeout(() => {
        for (const ws of clients.keys()) ws.terminate();
        clients.clear();
      }, CLIENT_CLOSE_DRAIN_MS);
      forceClose.unref();

      for (const ws of clients.keys()) {
        if (ws.readyState === ws.OPEN) ws.close(1001, 'sidecar shutting down');
        else ws.terminate();
      }
      wss.close(() => {
        clearTimeout(forceClose);
        settled();
      });
      server.close(settled);
    });
    return closePromise;
  }

  return {
    get port() {
      return boundPort;
    },
    ready,
    broadcast,
    close,
  };
}

// Optional on a send; queue actions name the steer they are for.
function assertValidSteerId(command: object): void {
  const withdrawing = 'type' in command && command.type === 'session.withdrawSteer';
  const required = withdrawing || ('type' in command && command.type === 'session.sendNow');
  if (!required && !('steerId' in command)) return;
  const steerId = 'steerId' in command ? command.steerId : undefined;
  if (typeof steerId !== 'string' || !steerId) throw new Error('Invalid steer id.');
  if (withdrawing) {
    if (
      !('appSessionId' in command) ||
      typeof command.appSessionId !== 'string' ||
      !command.appSessionId
    )
      throw new Error('Invalid app session id.');
    if (!('requestId' in command) || typeof command.requestId !== 'string' || !command.requestId)
      throw new Error('Invalid withdrawal request id.');
  }
}

function assertValidChatPreferences(command: object): void {
  const settingsCommand =
    'type' in command &&
    (command.type === 'session.create' || command.type === 'session.updateSettings');
  if ('fastMode' in command) {
    if (typeof command.fastMode !== 'boolean') throw new Error('fastMode must be a boolean.');
    if (!settingsCommand) throw new Error('Fast mode only applies to top-level session settings.');
  }
  if ('contextWindowTokens' in command) {
    if (command.contextWindowTokens !== 200000 && command.contextWindowTokens !== 1000000)
      throw new Error('contextWindowTokens must be 200000 or 1000000.');
    if (!settingsCommand)
      throw new Error('A context window only applies to top-level session settings.');
  }
}

// A read of a harness account can start that harness's process, so the
// harness and both switches must be exactly what the sidecar expects.
function assertValidUsageRefresh(command: object): void {
  if (!('type' in command) || command.type !== 'usage.refresh') return;
  const { provider, panelOpen, immediate } = command as Record<string, unknown>;
  if (!providerKind(provider)) throw new Error('usage.refresh needs a known harness.');
  if (typeof panelOpen !== 'boolean' || typeof immediate !== 'boolean')
    throw new Error('usage.refresh needs panelOpen and immediate as booleans.');
}

function maxBufferedAmount(clients: Iterable<WebSocket>): number {
  let max = 0;
  for (const ws of clients) max = Math.max(max, ws.bufferedAmount);
  return max;
}

function nonNegativeInteger(value: string | null): number | null {
  if (value === null || value.trim() === '') return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : null;
}

function rawSize(raw: RawData): number {
  if (Array.isArray(raw)) return raw.reduce((total, chunk) => total + chunk.length, 0);
  return raw instanceof ArrayBuffer ? raw.byteLength : raw.length;
}
