import assert from 'node:assert/strict';
import test, { afterEach, beforeEach } from 'node:test';

import { Bridge } from './bridge';
import { adaptEvent, initialState, reducer } from '../hooks/useStore';
import type { ServerEvent, ServerEventBatch } from '../types/bridge';

class FakeWebSocket {
  static readonly OPEN = 1;
  static instances: FakeWebSocket[] = [];

  readyState = 0;
  sent: string[] = [];
  onopen: (() => void) | null = null;
  onclose: (() => void) | null = null;
  onmessage: ((event: MessageEvent<string>) => void) | null = null;
  onerror: (() => void) | null = null;
  closeArgs: [number | undefined, string | undefined] | null = null;

  constructor(readonly url: string) {
    FakeWebSocket.instances.push(this);
  }

  send(value: string): void {
    this.sent.push(value);
  }

  open(): void {
    this.readyState = FakeWebSocket.OPEN;
    this.onopen?.();
  }

  message(message: unknown): void {
    this.onmessage?.({ data: JSON.stringify(message) } as MessageEvent<string>);
  }

  close(code?: number, reason?: string): void {
    if (code !== undefined && code !== 1000 && (code < 3000 || code > 4999))
      throw new DOMException('Invalid WebSocket close code.', 'InvalidAccessError');
    this.closeArgs = [code, reason];
    this.readyState = 3;
    this.onclose?.();
  }
}

function batch(
  generation: string,
  firstSeq: number,
  lastSeq: number,
  events: ServerEvent[],
): ServerEventBatch {
  return {
    type: 'events.batch',
    generation,
    firstSeq,
    lastSeq,
    events: events.map((event, index) => ({ seq: firstSeq + index, event })),
  };
}

const RUNTIME = { mode: 'cli_auth', droidPath: '/bin/droid', apiKeyConfigured: false } as const;
const CONNECTED: ServerEvent = { type: 'connection', status: 'connected' };

function snapshotMessage(generation: string, lastSeq: number, reason: string, snapshot = {}) {
  return {
    type: 'bridge.snapshot',
    generation,
    lastSeq,
    reason,
    snapshot: {
      runtime: RUNTIME,
      sessions: [],
      children: [],
      processes: {},
      persistence: { durable: true, hadUnflushedWork: false },
      interrupted: [],
      ...snapshot,
    },
  };
}

// The page ID is random per page; the rest of the URL is the contract.
function withoutPageId(url: string): string {
  const parsed = new URL(url);
  assert.match(parsed.searchParams.get('pageId') ?? '', /^[0-9a-f-]{36}$/);
  parsed.searchParams.delete('pageId');
  return parsed.toString().replace('/?', '?');
}

let previousGlobals: { window: Window & typeof globalThis; WebSocket: typeof WebSocket };

beforeEach(() => {
  previousGlobals = { window: globalThis.window, WebSocket: globalThis.WebSocket };
  FakeWebSocket.instances = [];
  Object.assign(globalThis, { window: { droidControl: {} }, WebSocket: FakeWebSocket });
});

afterEach(() => {
  Object.assign(globalThis, previousGlobals);
});

/** Starts a bridge on a fake socket, records every published event, and opens the socket. */
async function startBridge() {
  const reconnects: Array<() => void> = [];
  const bridge = new Bridge(
    async () => ({ port: 43120, token: 'test-token' }),
    (callback) => reconnects.push(callback),
  );
  const seen: ServerEvent[] = [];
  bridge.subscribe((event) => seen.push(event));
  await bridge.start();
  const socket = required(FakeWebSocket.instances.at(-1));
  socket.open();
  /** Runs the scheduled reconnect and returns the replacement socket. */
  const reconnect = async () => {
    reconnects.shift()?.();
    await Promise.resolve();
    await Promise.resolve();
    return required(FakeWebSocket.instances.at(-1));
  };
  const seenTypes = () => seen.map((event) => event.type);
  return { bridge, socket, seen, seenTypes, reconnect };
}

function resumeCursor(socket: FakeWebSocket) {
  const params = new URL(socket.url).searchParams;
  return { generation: params.get('resumeGeneration'), seq: params.get('resumeSeq') };
}

test('bridge refreshes sidecar identity before reconnecting', async () => {
  const reconnects: Array<() => void> = [];
  const bridgeInfos = [
    { port: 43001, token: 'first-token' },
    { port: 43002, token: 'second-token' },
  ];
  const bridge = new Bridge(
    async () => {
      const info = bridgeInfos.shift();
      assert.ok(info);
      return info;
    },
    (callback) => reconnects.push(callback),
  );

  await bridge.start();
  const first = FakeWebSocket.instances.at(-1);
  assert.ok(first);
  assert.equal(withoutPageId(first.url), 'ws://127.0.0.1:43001?token=first-token&bridgeProtocol=9');
  assert.equal(bridge.sendIfConnected({ type: 'runtime.status' }), false);
  assert.deepEqual(first.sent, []);
  first.close();
  assert.equal(reconnects.length, 1);

  reconnects.shift()?.();
  await Promise.resolve();
  await Promise.resolve();
  const second = FakeWebSocket.instances.at(-1);
  assert.ok(second);
  assert.equal(
    withoutPageId(second.url),
    'ws://127.0.0.1:43002?token=second-token&bridgeProtocol=9',
  );
  second.open();
  assert.equal(bridge.sendIfConnected({ type: 'runtime.status' }), true);
  assert.deepEqual(
    second.sent.map((command) => JSON.parse(command)),
    [{ type: 'runtime.status' }],
  );
});

test('[R1] Renderer command round trip', async () => {
  const baselineAdoptions: unknown[][] = [];
  Object.assign(globalThis, {
    window: {
      droidControl: {
        bridgeInfo: async () => ({ port: 43123, token: 'r1-token' }),
        gitAdoptTurnBaseline: async (...args: unknown[]) => {
          baselineAdoptions.push(args);
          return { ok: true };
        },
      },
    },
  });
  const {
    createSession,
    interruptVisibleSession,
    loadChildHistory,
    openChild,
    reanchorSessionsForWorktreeRemoval,
    updateChildSettings,
  } = await import('./commands.js');
  const { bridge } = await import('./bridge.js');
  const seen: ServerEvent[] = [];
  const unsubscribe = bridge.subscribe((event) => seen.push(event));

  createSession({
    clientRef: 'r1-create',
    title: 'R1',
    goal: 'hello',
    sessionPurpose: 'chat',
    interactionMode: 'auto',
    autonomy: 'low',
  });
  updateChildSettings({
    parentAppSessionId: 'r1',
    childSessionId: 'worker-r1',
    modelId: 'model-r1',
    reasoningEffort: 'high',
  });
  openChild('r1', 'validator-r1', 'open-validator-r1');
  loadChildHistory('r1', 'validator-r1', 'cursor-r1', 240);
  interruptVisibleSession('r1', 'worker-r1');
  interruptVisibleSession('r1');
  await bridge.start();
  const socket = required(FakeWebSocket.instances.at(-1));
  let seq = 0;
  const deliver = (event: ServerEvent) => {
    seq += 1;
    socket.message(batch('test-generation', seq, seq, [event]));
  };

  assert.equal(withoutPageId(socket.url), 'ws://127.0.0.1:43123?token=r1-token&bridgeProtocol=9');
  assert.deepEqual(socket.sent, []);
  socket.open();
  assert.equal(socket.sent.length, 6);
  assert.deepEqual(JSON.parse(socket.sent[0]), {
    type: 'session.create',
    clientRef: 'r1-create',
    title: 'R1',
    goal: 'hello',
    sessionPurpose: 'chat',
    interactionMode: 'auto',
    autonomy: 'low',
  });
  assert.deepEqual(JSON.parse(socket.sent[1]), {
    type: 'child.updateSettings',
    parentAppSessionId: 'r1',
    childSessionId: 'worker-r1',
    modelId: 'model-r1',
    reasoningEffort: 'high',
  });
  assert.deepEqual(JSON.parse(socket.sent[2]), {
    type: 'child.open',
    parentAppSessionId: 'r1',
    childSessionId: 'validator-r1',
    requestId: 'open-validator-r1',
  });
  assert.deepEqual(JSON.parse(socket.sent[3]), {
    type: 'child.loadHistory',
    parentAppSessionId: 'r1',
    childSessionId: 'validator-r1',
    cursor: 'cursor-r1',
    limit: 240,
  });
  assert.deepEqual(JSON.parse(socket.sent[4]), {
    type: 'child.interrupt',
    parentAppSessionId: 'r1',
    childSessionId: 'worker-r1',
  });
  assert.deepEqual(JSON.parse(socket.sent[5]), {
    type: 'session.interrupt',
    appSessionId: 'r1',
  });
  const reanchoring = reanchorSessionsForWorktreeRemoval('/repo/.worktrees/feature', '/repo');
  const reanchorCommand = JSON.parse(socket.sent[6] ?? '') as {
    type: string;
    requestId: string;
    fromCwd: string;
    toCwd: string;
  };
  assert.deepEqual(reanchorCommand, {
    type: 'sessions.reanchorCwd',
    requestId: reanchorCommand.requestId,
    fromCwd: '/repo/.worktrees/feature',
    toCwd: '/repo',
  });
  deliver({
    type: 'sessions.cwdReanchored',
    requestId: reanchorCommand.requestId,
    ok: true,
    count: 2,
  });
  assert.equal(await reanchoring, 2);
  const session = {
    appSessionId: 'r1',
    providerSessionId: 'provider-r1',
    provider: 'droid',
    sessionPurpose: 'chat',
    interactionMode: 'auto',
    role: 'primary',
    title: 'R1',
    goal: 'hello',
    cwd: '/repo',
    autonomy: 'low',
    phase: 'intake',
    features: [],
    tokensIn: 0,
    tokensOut: 0,
    contextTokens: 0,
    createdAt: 0,
    updatedAt: 0,
  } as const;

  deliver({ type: 'session.created', clientRef: 'r1-create', session });
  assert.deepEqual(baselineAdoptions, [['/repo', 'r1-create', 'r1']]);
  assert.equal(seen.length, 2);
  unsubscribe();
  deliver({ type: 'session.updated', session });
  assert.equal(seen.length, 2);
  assert.equal(FakeWebSocket.instances.length, 1);
});

test('bridge publishes one server batch while preserving per-event subscribers', async () => {
  const { bridge, socket, seenTypes } = await startBridge();
  const batches: string[][] = [];
  bridge.subscribeBatch((events) => batches.push(events.map((event) => event.type)));
  socket.message(
    batch('generation-1', 1, 2, [CONNECTED, { type: 'runtime.updated', status: RUNTIME }]),
  );

  assert.deepEqual(seenTypes(), ['connection', 'runtime.updated']);
  assert.deepEqual(batches, [['connection', 'runtime.updated']]);
});

test('bridge accepts direct command errors but ignores unbatched events', async () => {
  const { bridge, socket } = await startBridge();
  const batches: string[][] = [];
  bridge.subscribeBatch((events) => batches.push(events.map((event) => event.type)));
  socket.message(CONNECTED);
  socket.message({ type: 'error', message: 'Invalid JSON command' });
  assert.deepEqual(batches, [['error']]);
});

test('reconnect carries the last fully applied generation and sequence', async () => {
  const { socket: first, reconnect } = await startBridge();
  first.message(batch('generation-1', 1, 1, [CONNECTED]));
  first.close();

  const second = await reconnect();
  const url = new URL(second.url);
  const pageId = new URL(first.url).searchParams.get('pageId');
  assert.equal(url.searchParams.get('bridgeProtocol'), '9');
  assert.ok(pageId);
  assert.equal(url.searchParams.get('pageId'), pageId);
  assert.deepEqual(resumeCursor(second), { generation: 'generation-1', seq: '1' });
});

test('coalesced sequence gaps inside one batch advance the resume cursor safely', async () => {
  const { socket: first, seenTypes, reconnect } = await startBridge();
  first.message({
    type: 'events.batch',
    generation: 'generation-1',
    firstSeq: 1,
    lastSeq: 3,
    events: [{ seq: 3, event: CONNECTED }],
  });

  assert.deepEqual(seenTypes(), ['connection']);
  assert.equal(first.closeArgs, null);
  first.close();
  assert.deepEqual(resumeCursor(await reconnect()), { generation: 'generation-1', seq: '3' });
});

test('a generation-changed snapshot restores the cursor without a hard resync error', async () => {
  const { bridge, socket: first, seenTypes, reconnect } = await startBridge();
  // The store drops pending setting changes here: the process that would have
  // answered them is gone.
  const eventsWhenReplaced: string[][] = [];
  bridge.subscribeRuntimeReplaced(() => eventsWhenReplaced.push(seenTypes()));
  first.message(snapshotMessage('generation-2', 42, 'generation_changed'));

  assert.deepEqual(eventsWhenReplaced, [[]]);
  assert.deepEqual(seenTypes(), [
    'connection',
    'runtime.updated',
    'sessions.processes',
    'history.persistenceRecovered',
  ]);
  first.close();
  assert.deepEqual(resumeCursor(await reconnect()), { generation: 'generation-2', seq: '42' });
});

test('late messages from a replaced socket are ignored', async () => {
  const { socket: first, seenTypes, reconnect } = await startBridge();
  first.close();
  const second = await reconnect();
  second.open();

  first.message(batch('generation-1', 1, 1, [CONNECTED]));
  second.message(batch('generation-1', 1, 1, [CONNECTED]));
  assert.deepEqual(seenTypes(), ['connection']);
});

test('recovery snapshots replace process lists, including sessions that disappeared', async () => {
  const { bridge, socket } = await startBridge();
  // A snapshot from the same sidecar abandons nothing; one from a new one does.
  let replaced = 0;
  bridge.subscribeRuntimeReplaced(() => {
    replaced += 1;
  });
  let state = initialState;
  bridge.subscribe((event) => {
    const action = adaptEvent(event);
    if (action) state = reducer(state, action);
  });
  const process = {
    pid: 123,
    name: 'vite',
    command: 'node vite.js',
    originCommand: 'npm run dev',
    ports: [5173],
    startedAt: 1,
  };
  socket.message(
    batch('generation-1', 1, 1, [
      { type: 'session.processes', appSessionId: 'closed-session', processes: [process] },
    ]),
  );
  assert.deepEqual(state.agentProcesses, { 'closed-session': [process] });
  socket.message(
    snapshotMessage('generation-1', 42, 'replay_unavailable', {
      processes: { 'live-session': [process] },
    }),
  );
  assert.deepEqual(state.agentProcesses, { 'live-session': [process] });
  assert.equal(replaced, 0);
  socket.message(snapshotMessage('generation-2', 42, 'generation_changed'));
  assert.deepEqual(state.agentProcesses, {});
  assert.equal(replaced, 1);
});

test('duplicate replay batches are ignored and sequence gaps reconnect', async () => {
  const { socket, seenTypes } = await startBridge();
  const first = batch('generation-1', 1, 1, [CONNECTED]);
  socket.message(first);
  socket.message(first);
  assert.deepEqual(seenTypes(), ['connection']);

  socket.message(batch('generation-1', 3, 3, [CONNECTED]));
  assert.deepEqual(socket.closeArgs, [4012, 'bridge event sequence gap']);
});

test('malformed batches reset the cursor and reconnect without publishing payloads', async () => {
  const { socket: first, seen, reconnect } = await startBridge();
  first.message({
    type: 'events.batch',
    generation: 'generation-1',
    firstSeq: 1,
    lastSeq: 1,
    events: null,
  });

  assert.deepEqual(first.closeArgs, [4002, 'malformed bridge message']);
  assert.deepEqual(seen, [
    {
      type: 'error',
      code: 'bridge.resync_required',
      message: 'The agent runtime sent a malformed event batch. Reconnecting with a fresh cursor.',
      recoverable: true,
    },
  ]);
  assert.deepEqual(resumeCursor(await reconnect()), { generation: null, seq: null });
});

test('an entirely invalid batch warns once and advances the cursor without reconnecting', async (t) => {
  const warn = t.mock.method(console, 'warn', () => {});
  const { socket, seen, reconnect } = await startBridge();
  const invalidBatch = {
    type: 'events.batch',
    generation: 'generation-1',
    firstSeq: 1,
    lastSeq: 1,
    events: [{ seq: 1, event: { type: 'session.updated' } }],
  };
  socket.message(invalidBatch);
  socket.message(invalidBatch);

  assert.equal(socket.closeArgs, null);
  assert.deepEqual(seen, []);
  assert.equal(warn.mock.calls.length, 1);
  assert.deepEqual(warn.mock.calls[0].arguments, [
    'Dropped bridge event: isServerEvent check failed',
    { type: 'session.updated', seq: 1 },
  ]);
  socket.close();
  assert.deepEqual(resumeCursor(await reconnect()), { generation: 'generation-1', seq: '1' });
});

test('a mixed batch preserves valid events and advances past an invalid last event', async (t) => {
  const warn = t.mock.method(console, 'warn', () => {});
  const { bridge, socket, seen, reconnect } = await startBridge();
  const batches: ServerEvent[][] = [];
  bridge.subscribeBatch((events) => batches.push([...events]));
  const runtime: ServerEvent = { type: 'runtime.updated', status: RUNTIME };
  socket.message({
    type: 'events.batch',
    generation: 'generation-1',
    firstSeq: 1,
    lastSeq: 4,
    events: [
      { seq: 1, event: CONNECTED },
      { seq: 2, event: { type: 'projects.snapshot', projects: [{ secret: 'private payload' }] } },
      { seq: 3, event: runtime },
      { seq: 4, event: { type: 'session.updated' } },
    ],
  });

  assert.equal(socket.closeArgs, null);
  assert.deepEqual(seen, [CONNECTED, runtime]);
  assert.deepEqual(batches, [[CONNECTED, runtime]]);
  assert.deepEqual(
    warn.mock.calls.map((call) => call.arguments),
    [
      ['Dropped bridge event: isServerEvent check failed', { type: 'projects.snapshot', seq: 2 }],
      ['Dropped bridge event: isServerEvent check failed', { type: 'session.updated', seq: 4 }],
    ],
  );
  socket.message(batch('generation-1', 5, 5, [CONNECTED]));
  assert.equal(socket.closeArgs, null);
  assert.deepEqual(seen, [CONNECTED, runtime, CONNECTED]);
  socket.close();
  assert.deepEqual(resumeCursor(await reconnect()), { generation: 'generation-1', seq: '5' });
});

test('empty reset generations cannot replace a valid resume cursor', async () => {
  const { socket: first, seenTypes, reconnect } = await startBridge();
  first.message(batch('generation-1', 1, 1, [CONNECTED]));
  first.message({ type: 'bridge.reset', generation: '', lastSeq: 1, reason: 'invalid_resume' });

  first.close();
  assert.deepEqual(resumeCursor(await reconnect()), { generation: 'generation-1', seq: '1' });
  assert.deepEqual(seenTypes(), ['connection']);
});

test('snapshot storage failures reach clients without an earlier error event', async () => {
  const { socket, seen, seenTypes } = await startBridge();
  socket.message(
    snapshotMessage('generation-9', 8, 'generation_changed', {
      persistence: {
        durable: false,
        hadUnflushedWork: true,
        message: 'Previous process had unflushed history.',
      },
    }),
  );
  socket.message(batch('generation-9', 8, 8, [CONNECTED]));
  socket.message(batch('generation-9', 9, 9, [CONNECTED]));

  assert.deepEqual(seenTypes(), [
    'connection',
    'runtime.updated',
    'sessions.processes',
    'history.persistenceRecovered',
    'error',
    'connection',
  ]);
  assert.deepEqual(
    seen.flatMap((event) => (event.type === 'error' ? [event.code] : [])),
    ['history.unflushed_work'],
  );
  socket.message(
    snapshotMessage('generation-10', 0, 'generation_changed', {
      persistence: {
        durable: false,
        hadUnflushedWork: false,
        unavailableReason: 'Cannot open history.',
      },
    }),
  );
  const unavailable = seen.find(
    (event) => event.type === 'error' && event.code === 'history.unavailable',
  );
  assert.ok(unavailable);
  assert.equal(unavailable.type, 'error');
  if (unavailable.type === 'error') assert.match(unavailable.message, /Cannot open history/);
  const repairInstructions =
    'Search storage is corrupt. Quit DROIDEX, back up storage, then repair.';
  socket.message(
    snapshotMessage('generation-11', 0, 'generation_changed', {
      persistence: {
        durable: true,
        hadUnflushedWork: false,
        searchUnavailableReason: repairInstructions,
      },
    }),
  );
  const searchUnavailable = seen.find(
    (event) => event.type === 'error' && event.code === 'history.search_unavailable',
  );
  assert.ok(searchUnavailable);
  if (searchUnavailable.type === 'error') {
    assert.ok(searchUnavailable.message.includes(repairInstructions));
  }
});

function required<T>(value: T | undefined): T {
  if (value === undefined) throw new Error('expected fake socket');
  return value;
}
