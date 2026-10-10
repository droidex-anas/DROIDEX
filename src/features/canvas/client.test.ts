import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import test from 'node:test';
import { listCanvasAssets } from '../../../sidecar/src/canvas/canvasAssets.js';
import { createCanvasCommandHandler } from '../../../sidecar/src/canvas/canvasBridge.js';
import { CanvasScopes } from '../../../sidecar/src/canvas/canvasScopes.js';
import { CanvasWorkspace } from '../../../sidecar/src/canvas/CanvasWorkspace.js';
import {
  CANVAS_PNG,
  CANVAS_PNG_ASSET_ID,
  canvasRoot,
  quietBuilds,
} from '../../../sidecar/src/testing/canvasStorageSupport.js';
import { initialState, reducer } from '../../hooks/useStore';
import { initialCanvasPaneState, reduceCanvasPane, watchedCanvasId } from './canvasState';
import { isCanvasEvent } from './wireValidation';
import { CanvasClient } from './client';
import { fakeCanvasBridge, flush } from '../../test/canvasTransport';
import type { CanvasChange, CanvasFrame, CanvasSnapshot } from './protocol';

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

/** A watched canvas seeded at `sequence`, plus the projections its listener saw. */
async function watching(sequence: number) {
  const bridge = fakeCanvasBridge();
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
  const bridge = fakeCanvasBridge();
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

test('asset listing round trips through the renderer boundary and rejects a refused request', async (t) => {
  const scopes = new CanvasScopes();
  const builds = quietBuilds();
  const root = await canvasRoot(t);
  const workspace = await CanvasWorkspace.open(root, builds, {
    isChatKnown: (id) => id === 'app-1',
    isScopeActive: (id) => scopes.isScopeActive(id),
    bindScopeCanvas: (id, canvasId) => scopes.bindScopeCanvas(id, canvasId),
  });
  t.after(() => workspace.close());
  const { canvasId } = await workspace.createCanvas('app-1', 'create-assets');
  const filePath = join(root, 'chosen.png');
  await writeFile(filePath, CANVAS_PNG);
  await workspace.importCanvasImage({
    canvasId,
    filePath,
    digest: CANVAS_PNG_ASSET_ID,
    width: 1,
    height: 1,
  });
  const bridge = fakeCanvasBridge();
  const client = new CanvasClient(bridge.transport);
  const { handle } = createCanvasCommandHandler(
    Promise.resolve(workspace),
    scopes,
    builds,
    { secret: 'test-canvas-secret', list: (id) => listCanvasAssets(root, id) },
    (event) => {
      const serialized: Record<string, unknown> = JSON.parse(JSON.stringify(event));
      assert.ok(isCanvasEvent(serialized));
      bridge.deliver(serialized);
    },
    () => () => {},
  );
  const listing = client.listAssets(canvasId);
  await handle(bridge.last('canvas.listAssets'), 'page-1');
  assert.deepEqual(await listing, [
    {
      assetId: CANVAS_PNG_ASSET_ID,
      mediaType: 'image/png',
      byteLength: CANVAS_PNG.length,
      width: 1,
      height: 1,
    },
  ]);

  const refused = assert.rejects(client.listAssets('cv_missing'), { code: 'invalid_input' });
  await handle(bridge.last('canvas.listAssets'), 'page-1');
  await refused;
});

test('a replayed Create keeps the current attachment in the bridge reply, pane and renderer cache', async (t) => {
  const scopes = new CanvasScopes();
  const builds = quietBuilds();
  const root = await canvasRoot(t);
  const workspace = await CanvasWorkspace.open(root, builds, {
    isChatKnown: (id) => id === 'app-1',
    isScopeActive: (id) => scopes.isScopeActive(id),
    bindScopeCanvas: (id, canvasId) => scopes.bindScopeCanvas(id, canvasId),
  });
  t.after(() => workspace.close());
  const transport = fakeCanvasBridge();
  const client = new CanvasClient(transport.transport);
  const { handle } = createCanvasCommandHandler(
    Promise.resolve(workspace),
    scopes,
    builds,
    { secret: 'test-canvas-secret', list: (canvasId) => listCanvasAssets(root, canvasId) },
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
    reduceCanvasPane(initialCanvasPaneState(first.canvasId), { type: 'attaching' }),
    { type: 'settled', canvasId: replay.attachedCanvasId },
  );
  assert.equal(cached.canvasAttachments['app-1'], current.canvasId);
  assert.equal(watchedCanvasId(pane), current.canvasId);
  assert.equal(workspace.attachedCanvasId('app-1'), current.canvasId);
  assert.equal(workspace.listCanvases().length, 2);
});

test('a change that commits after a snapshot was taken is applied, not dropped', async () => {
  const bridge = fakeCanvasBridge();
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
  const bridge = fakeCanvasBridge();
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
  const bridge = fakeCanvasBridge();
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
