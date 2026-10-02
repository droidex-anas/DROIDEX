import assert from 'node:assert/strict';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import test, { type TestContext } from 'node:test';

import { WebSocket } from 'ws';

import { assertValidInteractionResponse } from './interactionResponses.js';
import { startBridgeServer } from './bridgeServer.js';
import { droidexUserDataDir } from './droidexPaths.js';
import {
  BRIDGE_PROTOCOL_VERSION,
  type BridgeRuntimeSnapshot,
  type ClientCommand,
  type ServerEvent,
  type ServerEventBatch,
} from './protocol.js';
import { hotPathMetrics } from './telemetry/hotPathMetrics.js';

interface Harness {
  port: number;
  token: string;
  assetToken: string;
  broadcast(event: ServerEvent): void;
  close(): Promise<void>;
}

/** A bridge server on a free port, closed when the test ends. */
async function bridgeServer(
  t: TestContext,
  onCommand: (command: ClientCommand) => Promise<void> = async () => undefined,
  getSnapshot?: () => Promise<BridgeRuntimeSnapshot> | BridgeRuntimeSnapshot,
): Promise<Harness> {
  const token = 'test-token';
  const assetToken = 'test-asset-token';
  const server = startBridgeServer({
    requestedPort: 0,
    token,
    assetToken,
    onCommand,
    ...(getSnapshot ? { getSnapshot } : {}),
  });
  await server.ready;
  t.after(() => server.close());
  return {
    port: server.port,
    token,
    assetToken,
    broadcast: server.broadcast,
    close: () => server.close(),
  };
}

/** The bridge socket URL with a valid token and the current protocol, plus `query`. */
function bridgeUrl(harness: Harness, query = ''): string {
  return `ws://127.0.0.1:${String(harness.port)}?token=${harness.token}&bridgeProtocol=${String(BRIDGE_PROTOCOL_VERSION)}${query}`;
}

/** An open bridge socket recording every message it receives, closed when the test ends. */
async function connect(t: TestContext, harness: Harness, query = '') {
  const received: string[] = [];
  const socket = new WebSocket(bridgeUrl(harness, query));
  socket.on('message', (raw) => received.push(String(raw)));
  t.after(() => closeSocket(socket));
  await socketOpen(socket);
  return { socket, received };
}

function resumeQuery(batch: ServerEventBatch): string {
  return `&resumeGeneration=${encodeURIComponent(batch.generation)}&resumeSeq=${String(batch.lastSeq)}`;
}

test('voice ownership moves only on a successful start, and only the owner can stop', async (t) => {
  const commands: string[] = [];
  const harness = await bridgeServer(t, async (command) => {
    if (command.type === 'voice.start') {
      commands.push(`start:${command.attempt}`);
      if (command.attempt === 'failed') throw new Error('failed start');
    }
    if (command.type === 'voice.stop') commands.push('stop');
  });
  const { socket: first } = await connect(t, harness, '&pageId=page-one');
  const { socket: second } = await connect(t, harness, '&pageId=page-two');
  const send = async (socket: WebSocket, command: object, expected: string) => {
    socket.send(JSON.stringify(command));
    await waitFor(() => commands.includes(expected));
  };
  await send(
    first,
    { type: 'voice.start', appSessionId: 'chat-one', attempt: 'first' },
    'start:first',
  );
  // A start that fails leaves the first page the owner, so its stop is refused.
  await send(
    second,
    { type: 'voice.start', appSessionId: 'chat-one', attempt: 'failed' },
    'start:failed',
  );
  second.send(JSON.stringify({ type: 'voice.stop', appSessionId: 'chat-one' }));
  await send(
    second,
    { type: 'voice.start', appSessionId: 'chat-one', attempt: 'second' },
    'start:second',
  );
  // The second page owns the call now: the first page's late stop is refused.
  first.send(JSON.stringify({ type: 'voice.stop', appSessionId: 'chat-one' }));
  await send(second, { type: 'voice.stop', appSessionId: 'chat-one' }, 'stop');
  assert.deepEqual(commands, ['start:first', 'start:failed', 'start:second', 'stop']);
});

test('orphan voice cleanup publishes a closed state', async (t) => {
  const stops: string[] = [];
  let started = false;
  const harness = await bridgeServer(t, async (command) => {
    if (command.type === 'voice.start') started = true;
    if (command.type === 'voice.stop') stops.push(command.appSessionId);
  });
  const owner = new WebSocket(bridgeUrl(harness, '&pageId=page-one'));
  await socketOpen(owner);
  const { socket: observer } = await connect(t, harness, '&pageId=page-two');
  owner.send(JSON.stringify({ type: 'voice.start', appSessionId: 'chat-one', attempt: 'first' }));
  await waitFor(() => started);
  t.mock.timers.enable({ apis: ['setTimeout'] });
  await closeSocket(owner);
  let event: ServerEvent | undefined;
  observer.on('message', (raw) => {
    const batch = JSON.parse(String(raw)) as ServerEventBatch;
    event ??= batch.events.find((entry) => entry.event.type === 'voice.state')?.event;
  });
  // The server sees the close, stops the call and broadcasts over real I/O, so
  // fake time moves in small steps, past the reclaim window, until it arrives.
  for (let step = 0; step < 400 && !event; step += 1) {
    await new Promise((resolve) => setImmediate(resolve));
    t.mock.timers.tick(100);
  }
  assert.deepEqual(event, { type: 'voice.state', appSessionId: 'chat-one', status: 'closed' });
  assert.deepEqual(stops, ['chat-one']);
});

test('broadcast after close is dropped instead of throwing', async (t) => {
  const harness = await bridgeServer(t);
  await harness.close();
  assert.doesNotThrow(() => harness.broadcast({ type: 'connection', status: 'connected' }));
});

test('browser assets are served only with the asset token', async (t) => {
  const harness = await bridgeServer(t);
  const root = join(droidexUserDataDir(), `bridge-asset-${String(Date.now())}`);
  mkdirSync(root, { recursive: true });
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const asset = join(root, 'ok.png');
  writeFileSync(asset, 'png-ok');
  const assetUrl = (path: string, token = harness.assetToken) =>
    `http://127.0.0.1:${String(harness.port)}/browser-assets?path=${encodeURIComponent(path)}&token=${token}`;

  assert.equal((await fetch(assetUrl(asset, harness.token))).status, 401);
  const response = await fetch(assetUrl(asset));
  assert.equal(response.status, 200);
  assert.equal(await response.text(), 'png-ok');
});

test('the socket handshake rejects a wrong token and stale bridge protocols', async (t) => {
  const harness = await bridgeServer(t);
  const wrongToken = new WebSocket(`ws://127.0.0.1:${String(harness.port)}?token=wrong`);
  assert.equal(await socketCloseCode(wrongToken), 1008);
  for (const protocol of ['', '&bridgeProtocol=3']) {
    const socket = new WebSocket(
      `ws://127.0.0.1:${String(harness.port)}?token=${harness.token}${protocol}`,
    );
    assert.equal(await socketCloseCode(socket), 1002);
  }
});

test('batch-capable client receives one ordered event envelope', async (t) => {
  const harness = await bridgeServer(t);
  const { received } = await connect(t, harness);

  harness.broadcast({ type: 'mission.progress', appSessionId: 'app', entries: [] });
  harness.broadcast({ type: 'mission.progress', appSessionId: 'app', entries: [] });
  await waitFor(() => received.length === 1);

  const batch = JSON.parse(received[0] ?? '') as ServerEventBatch;
  assert.equal(batch.type, 'events.batch');
  assert.equal(batch.firstSeq, 1);
  assert.equal(batch.lastSeq, 2);
  assert.deepEqual(
    batch.events.map((entry) => entry.event.type),
    ['mission.progress', 'mission.progress'],
  );
});

test('same-process reconnect replays batches after the acknowledged sequence', async (t) => {
  const harness = await bridgeServer(t);
  const first = await connect(t, harness);
  harness.broadcast({ type: 'connection', status: 'connected' });
  await waitFor(() => first.received.length === 1);
  const acknowledged = JSON.parse(first.received[0] ?? '') as ServerEventBatch;
  await closeSocket(first.socket);

  harness.broadcast({
    type: 'runtime.updated',
    status: { mode: 'cli_auth', droidPath: '/bin/droid', apiKeyConfigured: false },
  });

  const { received: replayed } = await connect(t, harness, resumeQuery(acknowledged));
  await waitFor(() => replayed.length === 1);
  const batch = JSON.parse(replayed[0] ?? '') as ServerEventBatch;
  assert.equal(batch.firstSeq, acknowledged.lastSeq + 1);
  assert.equal(batch.events[0]?.event.type, 'runtime.updated');
});

test('resume reset flushes pending sequences before admitting the client', async (t) => {
  const harness = await bridgeServer(t);
  harness.broadcast({ type: 'mission.progress', appSessionId: 'app', entries: [] });

  const { received } = await connect(t, harness, '&resumeSeq=999');
  await waitFor(() => received.length === 1);
  const reset = JSON.parse(received[0] ?? '') as {
    type: string;
    generation: string;
    lastSeq: number;
    reason: string;
  };
  assert.equal(reset.type, 'bridge.reset');
  assert.equal(typeof reset.generation, 'string');
  assert.equal(reset.lastSeq, 1);
  assert.equal(reset.reason, 'invalid_resume');

  harness.broadcast({ type: 'connection', status: 'connected' });
  await waitFor(() => received.length === 2);
  const boundary = JSON.parse(received[1] ?? '') as ServerEventBatch;
  assert.equal(boundary.type, 'events.batch');
  assert.equal(boundary.firstSeq, 2);
  assert.equal(boundary.lastSeq, 2);
});

test('an oversized batch resets a reconnect cursor instead of replaying the payload', async (t) => {
  const harness = await bridgeServer(t);
  const first = await connect(t, harness);
  const firstClosed = socketCloseCode(first.socket);
  harness.broadcast({ type: 'connection', status: 'connected' });
  await waitFor(() => first.received.length === 1);
  const acknowledged = JSON.parse(first.received[0] ?? '') as ServerEventBatch;
  harness.broadcast({ type: 'error', message: 'x'.repeat(8 * 1024 * 1024) });
  assert.equal(await firstClosed, 1006);

  const { received: resumed } = await connect(t, harness, resumeQuery(acknowledged));
  await waitFor(() => resumed.length === 1);
  const snapshot = JSON.parse(resumed[0] ?? '') as {
    type: string;
    lastSeq: number;
    reason: string;
  };
  assert.equal(snapshot.type, 'bridge.snapshot');
  assert.equal(snapshot.lastSeq, 2);
  assert.equal(snapshot.reason, 'replay_unavailable');

  harness.broadcast({ type: 'connection', status: 'connected' });
  await waitFor(() => resumed.length === 2);
  const next = JSON.parse(resumed[1] ?? '') as ServerEventBatch;
  assert.equal(next.firstSeq, 3);
  assert.equal(next.lastSeq, 3);
});

test('a generation change sends a snapshot, delivered before later broadcasts', async (t) => {
  let releaseSnapshot: ((snapshot: BridgeRuntimeSnapshot) => void) | undefined;
  const harness = await bridgeServer(
    t,
    async () => undefined,
    () =>
      new Promise<BridgeRuntimeSnapshot>((resolve) => {
        releaseSnapshot = resolve;
      }),
  );
  const received: string[] = [];
  const socket = new WebSocket(bridgeUrl(harness, '&resumeGeneration=old-generation&resumeSeq=1'));
  socket.on('message', (raw) => received.push(String(raw)));
  t.after(() => closeSocket(socket));
  await waitFor(() => releaseSnapshot !== undefined);
  harness.broadcast({ type: 'connection', status: 'connected' });
  releaseSnapshot?.({
    runtime: { mode: 'cli_auth', droidPath: '/bin/droid', apiKeyConfigured: false },
    sessions: [],
    children: [],
    processes: {},
    persistence: { durable: true, hadUnflushedWork: false },
    interrupted: [],
  });
  await waitFor(() => received.length >= 2);
  const first = JSON.parse(received[0] ?? '') as { type: string; reason: string };
  assert.equal(first.type, 'bridge.snapshot');
  assert.equal(first.reason, 'generation_changed');
  const batch = JSON.parse(received[1] ?? '') as ServerEventBatch;
  assert.equal(batch.type, 'events.batch');
  assert.equal(batch.firstSeq, 1);
});

test('health and perf metrics require the bridge token, and event-loop sampling arms only on demand', async (t) => {
  hotPathMetrics.disable();
  t.after(() => hotPathMetrics.disable());
  const harness = await bridgeServer(t);
  const base = `http://127.0.0.1:${String(harness.port)}`;
  const health = async () => {
    const response = await fetch(`${base}/health?token=${harness.token}`);
    assert.equal(response.status, 200);
    return (await response.json()) as {
      ok: boolean;
      generation: string;
      lastSeq: number;
      eventLoopDelayMs: number;
    };
  };
  assert.equal((await fetch(`${base}/health`)).status, 401);
  assert.equal((await fetch(`${base}/perf/metrics`)).status, 401);
  const before = await health();
  assert.equal(before.ok, true);
  assert.equal(typeof before.generation, 'string');
  assert.equal(typeof before.lastSeq, 'number');
  assert.equal(before.eventLoopDelayMs, 0);

  const idle = await fetch(`${base}/perf/metrics?token=${harness.token}`);
  assert.equal(idle.status, 200);
  const idleBody = (await idle.json()) as {
    pid: number;
    counters: Record<string, number>;
    eventLoop: { meanMs: number } | null;
  };
  assert.equal(typeof idleBody.pid, 'number');
  assert.ok(idleBody.counters);
  assert.equal(idleBody.eventLoop, null);

  const armed = await fetch(`${base}/perf/metrics?token=${harness.token}&eventLoop=1`);
  const armedBody = (await armed.json()) as { eventLoop: { meanMs: number } | null };
  assert.ok(armedBody.eventLoop !== null);
  assert.ok(Number.isFinite(armedBody.eventLoop.meanMs));

  // Arming sampling does not change /health liveness.
  const after = await health();
  assert.equal(after.ok, true);
  assert.equal(typeof after.eventLoopDelayMs, 'number');
});

test('interaction responses require correlation and structured answers at the command boundary', () => {
  const approval = {
    type: 'approval.respond',
    appSessionId: 'app',
    requestId: 'approval',
    outcome: 'refuse',
  };
  assert.doesNotThrow(() => assertValidInteractionResponse(approval));
  assert.throws(() => assertValidInteractionResponse({ ...approval, requestId: '' }), /requestId/);
  assert.throws(
    () => assertValidInteractionResponse({ ...approval, outcome: 'unknown' }),
    /Unsupported permission outcome/,
  );
  const question = {
    type: 'question.respond',
    appSessionId: 'app',
    requestId: 'question',
    cancelled: false,
    answers: [{ index: 0, question: 'Choose', selected: ['A', 'B'], custom: 'C' }],
  };
  assert.doesNotThrow(() => assertValidInteractionResponse(question));
  for (const answer of [
    { index: 0, question: 'Choose', answer: 'A' },
    { ...question.answers[0], selected: [42] },
  ]) {
    assert.throws(
      () => assertValidInteractionResponse({ ...question, answers: [answer] }),
      /structured answers/,
    );
  }
});

test('fast mode rejects non-booleans before command dispatch', async (t) => {
  let commands = 0;
  const harness = await bridgeServer(t, async () => {
    commands += 1;
  });
  const { socket } = await connect(t, harness);
  for (const type of ['session.create', 'session.updateSettings']) {
    for (const fastMode of [null, 'true', 1, {}]) {
      const received = new Promise<string>((resolve) =>
        socket.once('message', (raw) => resolve(String(raw))),
      );
      socket.send(JSON.stringify({ type, fastMode }));
      assert.match(await received, /fastMode must be a boolean/);
    }
  }
  assert.equal(commands, 0);
  socket.send(
    JSON.stringify({ type: 'session.updateSettings', appSessionId: 'app', fastMode: false }),
  );
  await waitFor(() => commands === 1);
});

function socketOpen(socket: WebSocket): Promise<void> {
  return new Promise((resolve, reject) => {
    socket.once('open', () => resolve());
    socket.once('error', reject);
  });
}

function closeSocket(socket: WebSocket, timeoutMs = 2_000): Promise<void> {
  if (socket.readyState === WebSocket.CLOSED) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('socket close timed out')), timeoutMs);
    socket.once('close', () => {
      clearTimeout(timer);
      resolve();
    });
    socket.close();
  });
}

function socketCloseCode(socket: WebSocket, timeoutMs = 2_000): Promise<number> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('socket close timed out')), timeoutMs);
    socket.once('close', (code) => {
      clearTimeout(timer);
      resolve(code);
    });
  });
}

function waitFor(predicate: () => boolean, timeoutMs = 2_000): Promise<void> {
  return new Promise((resolve, reject) => {
    const finish = () => {
      clearTimeout(timer);
      clearInterval(interval);
    };
    const timer = setTimeout(() => {
      finish();
      reject(new Error('waitFor timed out'));
    }, timeoutMs);
    const interval = setInterval(() => {
      if (predicate()) {
        finish();
        resolve();
      }
    }, 10);
  });
}
