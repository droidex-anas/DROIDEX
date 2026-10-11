import assert from 'node:assert/strict';
import { mkdir, readdir, readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import test, { type TestContext } from 'node:test';
import {
  APP,
  PAGE,
  HEY,
  buildingCanvas,
  createCanvas,
  createFrame,
  errorOf,
  harness,
  okReply,
  turnScope,
  writeFrame,
} from '../testing/canvasBridgeSupport.js';
import { canvasRoot, quietBuilds, reopenWorkspace } from '../testing/canvasStorageSupport.js';
import { exportCanvasSource } from './canvasExport.js';
import { CanvasWorkspace, type CanvasWorkspaceDeps } from './CanvasWorkspace.js';

/** What a canvas root holds besides the writer lease. */
async function storedCanvases(root: string): Promise<string[]> {
  return (await readdir(root)).filter((name) => !name.startsWith('.writer-lease'));
}

function useProfile(t: TestContext, profile: string): void {
  const previous = process.env.DROIDEX_USER_DATA_DIR;
  process.env.DROIDEX_USER_DATA_DIR = profile;
  t.after(() => {
    if (previous === undefined) delete process.env.DROIDEX_USER_DATA_DIR;
    else process.env.DROIDEX_USER_DATA_DIR = previous;
  });
}

test('deleting a canvas discloses, then ends, its chats, turns and builds', async (t) => {
  const canvas = await buildingCanvas(t);
  const canvasId = await createCanvas(canvas);
  const designId = await createFrame(canvas, canvasId);
  await canvas.workspace.attach('app-2', canvasId);
  canvas.scopes.register(turnScope(canvasId, 'turn-1'));
  await canvas.handle({ type: 'canvas.subscribe', requestId: 'req-watch', canvasId });
  await writeFrame(canvas, canvasId, designId);
  const running = await canvas.fleet.compile(0);

  await canvas.handle({ type: 'canvas.removalPreview', requestId: 'req-preview', canvasId });
  assert.deepEqual(okReply(canvas, 'req-preview'), {
    kind: 'removalPreview',
    preview: {
      canvasId,
      name: 'Canvas 1',
      attachedAppSessionIds: [APP, 'app-2'],
      activeTurnAppSessionIds: ['agent-1'],
      buildingDesignIds: [designId],
    },
  });

  await canvas.handle({ type: 'canvas.removeCanvas', requestId: 'req-remove', canvasId });
  assert.deepEqual(okReply(canvas, 'req-remove'), { kind: 'ok' });
  assert.ok(running.signal.aborted);
  assert.equal(canvas.scopes.isScopeActive('turn-1'), false);
  assert.equal(canvas.workspace.attachedCanvasId(APP), null);
  assert.equal(canvas.workspace.attachedCanvasId('app-2'), null);
  // The open pane hears its frames go, and every page's list drops the canvas.
  assert.ok(
    canvas.events.some(
      (event) =>
        event.type === 'canvas.change' &&
        event.change.canvasId === canvasId &&
        event.change.removedDesignIds.includes(designId),
    ),
  );
  const summaries = canvas.events.filter((event) => event.type === 'canvas.summaries').at(-1);
  assert.deepEqual(summaries?.type === 'canvas.summaries' && summaries.summaries, []);
  assert.deepEqual(await storedCanvases(canvas.root), []);

  await canvas.handle({ type: 'canvas.removeCanvas', requestId: 'req-again', canvasId });
  assert.deepEqual(okReply(canvas, 'req-again'), { kind: 'ok' });
  await canvas.handle({ type: 'canvas.subscribe', requestId: 'req-rewatch', canvasId }, PAGE);
  assert.equal(errorOf(canvas, 'req-rewatch').code, 'invalid_input');
});

test('an export already reading a canvas completes as its snapshot when the canvas is deleted', async (t) => {
  const canvas = await harness(t);
  useProfile(t, dirname(canvas.root));
  const canvasId = await createCanvas(canvas);
  const designId = await createFrame(canvas, canvasId);
  await writeFrame(canvas, canvasId, designId);
  const revisionId = canvas.workspace.snapshot(canvasId).frames[0]?.revisionId;
  assert.ok(revisionId);
  const destination = join(dirname(canvas.root), 'export');
  await mkdir(destination);

  const exporting = exportCanvasSource(canvasId, { designId, revisionId }, destination);
  await canvas.workspace.removeCanvas(canvasId);
  assert.ok((await exporting).filesWritten > 0);
  assert.equal(await readFile(join(destination, 'src', 'main.tsx'), 'utf8'), HEY);
  assert.deepEqual(await storedCanvases(canvas.root), []);
});

test('closing its pane or losing its chat never deletes a canvas', async (t) => {
  const root = await canvasRoot(t);
  const chats = new Set([APP]);
  const deps: CanvasWorkspaceDeps = {
    isChatKnown: (appSessionId) => chats.has(appSessionId),
    isScopeActive: () => true,
    bindScopeCanvas: () => undefined,
  };
  const workspace = await CanvasWorkspace.open(root, quietBuilds(), deps);
  const { canvasId } = await workspace.createCanvas(APP, 'create-kept');
  await workspace.close();
  const canvas = await harness(t, { root });
  await canvas.handle({ type: 'canvas.subscribe', requestId: 'req-watch', canvasId });
  canvas.pageGone(PAGE);
  await canvas.workspace.close();

  chats.delete(APP);
  const reopened = await reopenWorkspace(t, root, deps);
  assert.deepEqual(
    reopened.listCanvases().map((summary) => [summary.canvasId, summary.attachedAppSessionIds]),
    [[canvasId, [APP]]],
  );
  assert.deepEqual(await storedCanvases(root), [canvasId]);
});
