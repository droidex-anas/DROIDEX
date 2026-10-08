import assert from 'node:assert/strict';
import test from 'node:test';
import { createCanvasCommandHandler } from '../../../sidecar/src/canvas/canvasBridge.js';
import { CanvasScopes } from '../../../sidecar/src/canvas/canvasScopes.js';
import { CanvasWorkspace } from '../../../sidecar/src/canvas/CanvasWorkspace.js';
import { canvasRoot, quietBuilds } from '../../../sidecar/src/testing/canvasStorageSupport.js';
import { initialState, reducer } from '../../hooks/useStore';
import { initialCanvasPaneState, reduceCanvasPane, watchedCanvasId } from './canvasState';
import { isCanvasEvent } from './wireValidation';
import type { ClientCommand, ServerEvent } from '../../types/bridge';
import { CanvasClient, type CanvasTransport } from './client';
import type { CanvasChange, CanvasCommand, CanvasFrame, CanvasSnapshot } from './protocol';

const designSystem = { id: 'droidex', version: 1, mode: 'light' } as const;
const CANVAS = 'cv_01';

function frame(designId: string, revisionId: string | null = null): CanvasFrame {
  return {
    designId,
    name: designId,
    rect: { x: 0, y: 0, width: 720, height: 720 },
    layoutVersion: 0,
    manifestVersion: 0,
    revisionId,
    designSystem,
    build: { status: 'pending', generation: 0 },
  };
}

function change(sequence: number, frames: CanvasFrame[] = []): CanvasChange {
  return { canvasId: CANVAS, sequence, frames, removedDesignIds: [] };
}

function isCanvasCommand(command: ClientCommand): command is CanvasCommand {
  return command.type.startsWith('canvas.');
}

/**
 * A transport the test drives directly, standing in for the bridge socket. Its
 * `reconnect` is the Bridge's own notification, which only a readmitted socket
 * fires: a first connection sends nothing, and an ordinary replay resume
 * publishes no event, so a client that waited for one would never catch up.
 */
function fakeBridge() {
  const sent: CanvasCommand[] = [];
  let receive: ((event: ServerEvent) => void) | null = null;
  let readmitted: (() => void) | null = null;
  let connected = true;
  const transport: CanvasTransport = {
    sendIfConnected(command: ClientCommand) {
      assert.ok(isCanvasCommand(command), 'the Canvas client sent a command it does not own');
      if (!connected) return false;
      sent.push(command);
      return true;
    },
    subscribe(listener) {
      receive = listener;
      return () => {
        receive = null;
      };
    },
    onReconnected(listener) {
      readmitted = listener;
      return () => {
        readmitted = null;
      };
    },
  };
  return {
    sent,
    transport,
    reconnect(): void {
      assert.ok(readmitted, 'the client is not watching for reconnections');
      readmitted();
    },
    /** The transport refusing a command, as it does when nothing is connected. */
    offline(): void {
      connected = false;
    },
    deliver(event: ServerEvent): void {
      assert.ok(receive, 'the client has not subscribed yet');
      receive(event);
    },
    /** The last command of a kind, so a test can answer it. */
    last(type: CanvasCommand['type']): CanvasCommand {
      const matched = sent.filter((command) => command.type === type);
      const command = matched.at(-1);
      assert.ok(command, `no ${type} was sent`);
      return command;
    },
    count(type: CanvasCommand['type']): number {
      return sent.filter((command) => command.type === type).length;
    },
  };
}

const flush = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

/** A watched canvas seeded at `sequence`, plus the projections its listener saw. */
async function watching(sequence: number) {
  const bridge = fakeBridge();
  const client = new CanvasClient(bridge.transport);
  const seen: CanvasSnapshot[] = [];
  const stop = client.subscribeCanvas(CANVAS, (snapshot) => seen.push(snapshot));
  const snapshot: CanvasSnapshot = { canvasId: CANVAS, sequence, frames: [frame('hey')] };
  bridge.deliver({
    type: 'canvas.snapshot',
    requestId: bridge.last('canvas.subscribe').requestId,
    snapshot,
  });
  await flush();
  return { bridge, client, seen, stop };
}

test('a canvas subscription is seeded by the snapshot its request answers', async () => {
  const { bridge, client, seen } = await watching(4);
  assert.equal(bridge.count('canvas.subscribe'), 1);
  assert.equal(client.snapshotOf(CANVAS)?.sequence, 4);
  assert.equal(seen.length, 1);
});

test('an older or duplicate change is ignored, and the next in sequence is applied', async () => {
  const { bridge, client, seen } = await watching(4);
  seen.length = 0;
  bridge.deliver({ type: 'canvas.change', change: change(4) });
  bridge.deliver({ type: 'canvas.change', change: change(3) });
  await flush();
  assert.equal(client.snapshotOf(CANVAS)?.sequence, 4);
  assert.deepEqual(seen, []);
  assert.equal(bridge.count('canvas.subscribe'), 1);

  bridge.deliver({ type: 'canvas.change', change: change(5, [frame('cta')]) });
  await flush();
  assert.equal(client.snapshotOf(CANVAS)?.sequence, 5);
  assert.deepEqual(
    client.snapshotOf(CANVAS)?.frames.map((entry) => entry.designId),
    ['hey', 'cta'],
  );
  assert.equal(seen.length, 1);
  assert.equal(bridge.count('canvas.subscribe'), 1);
});

test('a gap requests one fresh snapshot and drops the changes it supersedes', async () => {
  const { bridge, client, seen } = await watching(4);
  seen.length = 0;
  bridge.deliver({ type: 'canvas.change', change: change(9) });
  bridge.deliver({ type: 'canvas.change', change: change(10) });
  bridge.deliver({ type: 'canvas.change', change: change(11) });
  await flush();
  // One request in flight, and the projection untouched until it answers.
  assert.equal(bridge.count('canvas.subscribe'), 2);
  assert.equal(client.snapshotOf(CANVAS)?.sequence, 4);
  assert.deepEqual(seen, []);

  bridge.deliver({
    type: 'canvas.snapshot',
    requestId: bridge.last('canvas.subscribe').requestId,
    snapshot: { canvasId: CANVAS, sequence: 11, frames: [frame('hey', 'rev_11')] },
  });
  await flush();
  assert.equal(client.snapshotOf(CANVAS)?.sequence, 11);
  assert.equal(seen.length, 1);

  // Recovered: the client is following sequences again, not resyncing forever.
  bridge.deliver({ type: 'canvas.change', change: change(12) });
  await flush();
  assert.equal(client.snapshotOf(CANVAS)?.sequence, 12);
  assert.equal(bridge.count('canvas.subscribe'), 2);
});

test('a change for a canvas this client does not watch is ignored', async () => {
  const { bridge, client } = await watching(4);
  bridge.deliver({
    type: 'canvas.change',
    change: { canvasId: 'cv_other', sequence: 1, frames: [], removedDesignIds: [] },
  });
  await flush();
  assert.equal(client.snapshotOf(CANVAS)?.sequence, 4);
});

test('the last listener to leave stops the canvas and drops the projection', async () => {
  const { bridge, client, stop } = await watching(4);
  stop();
  assert.equal(client.snapshotOf(CANVAS), null);
  const unsubscribe = bridge.last('canvas.unsubscribe');
  bridge.deliver({
    type: 'canvas.result',
    requestId: unsubscribe.requestId,
    ok: true,
    reply: { kind: 'ok' },
  });
  await flush();
  bridge.deliver({ type: 'canvas.change', change: change(5) });
  await flush();
  assert.equal(client.snapshotOf(CANVAS), null);
});

test('a reported failure rejects its own request with the stable code', async () => {
  const bridge = fakeBridge();
  const client = new CanvasClient(bridge.transport);
  const listing = client.listCanvases();
  bridge.deliver({
    type: 'canvas.result',
    requestId: bridge.last('canvas.list').requestId,
    ok: false,
    error: { code: 'scope_expired', message: 'This chat is not attached to that canvas.' },
  });
  await assert.rejects(listing, { code: 'scope_expired' });

  const mutating = client.arrangeFrames('app-1', CANVAS, {
    mutationId: 'm-arrange',
    frames: [{ designId: 'hey', expectedLayoutVersion: 0, rect: frame('hey').rect }],
  });
  bridge.deliver({
    type: 'canvas.result',
    requestId: bridge.last('canvas.arrange').requestId,
    ok: true,
    reply: { kind: 'arranged', change: change(6, [frame('hey')]) },
  });
  assert.equal((await mutating).sequence, 6);
});

test('a replayed Create keeps the current attachment in the bridge reply, pane and renderer cache', async (t) => {
  const scopes = new CanvasScopes();
  const builds = quietBuilds();
  const workspace = await CanvasWorkspace.open(await canvasRoot(t), builds, {
    isChatKnown: (id) => id === 'app-1',
    isScopeActive: (id) => scopes.isScopeActive(id),
    bindScopeCanvas: (id, canvasId) => scopes.bindScopeCanvas(id, canvasId),
  });
  t.after(() => workspace.close());
  const transport = fakeBridge();
  const client = new CanvasClient(transport.transport);
  const handle = createCanvasCommandHandler(
    Promise.resolve(workspace),
    scopes,
    builds,
    (event) => {
      if (!event.type.startsWith('canvas.')) return;
      const serialized: Record<string, unknown> = JSON.parse(JSON.stringify(event));
      assert.ok(isCanvasEvent(serialized));
      transport.deliver(serialized);
    },
    () => () => {},
  );
  for (const mutationId of ['create-A', 'create-B']) {
    const creating = client.createCanvas('app-1', mutationId);
    await handle(transport.last('canvas.createCanvas'), 'page-1');
    await creating;
  }
  const [first, current] = workspace.listCanvases();
  assert.ok(first && current);
  const replaying = client.createCanvas('app-1', 'create-A');
  await handle(transport.last('canvas.createCanvas'), 'page-1');
  const replay = await replaying;
  assert.equal(replay.attachedCanvasId, current.canvasId);
  assert.equal(replay.canvasId, first.canvasId);
  const cached = reducer(
    { ...initialState, canvasAttachments: { 'app-1': first.canvasId } },
    {
      type: 'SET_CANVAS_ATTACHMENT',
      appSessionId: 'app-1',
      canvasId: replay.attachedCanvasId,
    },
  );
  const pane = reduceCanvasPane(
    reduceCanvasPane(initialCanvasPaneState(first.canvasId), { type: 'creating' }),
    { type: 'created', canvasId: replay.attachedCanvasId },
  );
  assert.equal(cached.canvasAttachments['app-1'], current.canvasId);
  assert.equal(watchedCanvasId(pane), current.canvasId);
  assert.equal(workspace.attachedCanvasId('app-1'), current.canvasId);
  assert.equal(workspace.listCanvases().length, 2);
});

test('a change that commits after a snapshot was taken is applied, not dropped', async () => {
  const bridge = fakeBridge();
  const client = new CanvasClient(bridge.transport);
  const seen: CanvasSnapshot[] = [];
  client.subscribeCanvas(CANVAS, (snapshot) => seen.push(snapshot));

  // The snapshot was taken before change 5 committed, so the change cannot be
  // dropped just because its answer was still in flight.
  bridge.deliver({
    type: 'canvas.snapshot',
    requestId: bridge.last('canvas.subscribe').requestId,
    snapshot: { canvasId: CANVAS, sequence: 4, frames: [frame('hey')] },
  });
  bridge.deliver({ type: 'canvas.change', change: change(5, [frame('cta')]) });
  await flush();

  assert.equal(client.snapshotOf(CANVAS)?.sequence, 5);
  assert.deepEqual(
    client.snapshotOf(CANVAS)?.frames.map((entry) => entry.designId),
    ['hey', 'cta'],
  );
  assert.equal(bridge.count('canvas.subscribe'), 1);
  assert.equal(seen.at(-1)?.sequence, 5);
});

test('a change queued behind a resync is applied onto the snapshot that answers it', async () => {
  const { bridge, client } = await watching(4);
  bridge.deliver({ type: 'canvas.change', change: change(9) });
  await flush();
  assert.equal(bridge.count('canvas.subscribe'), 2);

  // Arrives while the resync is in flight and commits after the snapshot.
  bridge.deliver({ type: 'canvas.change', change: change(10, [frame('cta')]) });
  bridge.deliver({
    type: 'canvas.snapshot',
    requestId: bridge.last('canvas.subscribe').requestId,
    snapshot: { canvasId: CANVAS, sequence: 9, frames: [frame('hey')] },
  });
  await flush();

  assert.equal(client.snapshotOf(CANVAS)?.sequence, 10);
  assert.equal(bridge.count('canvas.subscribe'), 2);
});

test('a dropped subscription cannot roll back the board that replaced it', async () => {
  const bridge = fakeBridge();
  const client = new CanvasClient(bridge.transport);
  const stop = client.subscribeCanvas(CANVAS, () => undefined);
  const abandoned = bridge.last('canvas.subscribe').requestId;
  stop();

  const seen: CanvasSnapshot[] = [];
  client.subscribeCanvas(CANVAS, (snapshot) => seen.push(snapshot));
  const current = bridge.last('canvas.subscribe').requestId;
  assert.notEqual(current, abandoned);
  bridge.deliver({
    type: 'canvas.snapshot',
    requestId: current,
    snapshot: { canvasId: CANVAS, sequence: 9, frames: [frame('hey')] },
  });
  await flush();
  bridge.deliver({ type: 'canvas.change', change: change(10) });
  bridge.deliver({ type: 'canvas.change', change: change(11) });
  await flush();
  assert.equal(client.snapshotOf(CANVAS)?.sequence, 11);

  // The first subscription's answer arrives at last; it belongs to nothing.
  bridge.deliver({
    type: 'canvas.snapshot',
    requestId: abandoned,
    snapshot: { canvasId: CANVAS, sequence: 4, frames: [frame('hey')] },
  });
  await flush();
  assert.equal(client.snapshotOf(CANVAS)?.sequence, 11);
  assert.equal(seen.at(-1)?.sequence, 11);

  // The replacement still owns its slot, so a gap can still resync it.
  const before = bridge.count('canvas.subscribe');
  bridge.deliver({ type: 'canvas.change', change: change(20) });
  await flush();
  assert.equal(bridge.count('canvas.subscribe'), before + 1);
});

test('a reconnected page watches its boards again and catches them up', async () => {
  const { bridge, client } = await watching(4);
  // A replay resume publishes no event, so only the transport can say this.
  bridge.reconnect();
  await flush();
  assert.equal(bridge.count('canvas.subscribe'), 2);

  bridge.deliver({
    type: 'canvas.snapshot',
    requestId: bridge.last('canvas.subscribe').requestId,
    snapshot: { canvasId: CANVAS, sequence: 12, frames: [frame('hey', 'rev_12')] },
  });
  await flush();
  assert.equal(client.snapshotOf(CANVAS)?.sequence, 12);
});

test('a refused send rejects its request instead of waiting for the timeout', async () => {
  const bridge = fakeBridge();
  const client = new CanvasClient(bridge.transport);
  bridge.offline();

  // A Canvas command is never queued for later: it carries a mutation ID and a
  // revision the runtime may have moved past by the time a queue drains. The
  // caller is told now, and this file exiting proves no timer was left behind.
  await assert.rejects(client.listCanvases(), /not connected, so that Canvas request was not sent/);
  await assert.rejects(
    client.createFrames('app-1', CANVAS, {
      mutationId: 'm-create',
      frames: [{ name: 'Hey', width: 720, height: 720, designSystem }],
    }),
    /not connected/,
  );
  assert.equal(bridge.sent.length, 0);
});
