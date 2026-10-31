import assert from 'node:assert/strict';
import test from 'node:test';
import { APP, createCanvas, errorOf, harness, okReply } from '../testing/canvasBridgeSupport.js';
import { CANVAS_PNG } from '../testing/canvasStorageSupport.js';

test('a canvas keeps the cover the pane saved across a reopen, and loses it with the canvas', async (t) => {
  const canvas = await harness(t);
  const canvasId = await createCanvas(canvas);
  const readCover = async (requestId: string, on = canvas) => {
    await on.handle({ type: 'canvas.readCover', requestId, canvasId });
    return okReply(on, requestId);
  };

  assert.deepEqual(await readCover('req-none'), { kind: 'cover', png: null });
  await canvas.handle({
    type: 'canvas.saveCover',
    requestId: 'req-not-png',
    canvasId,
    png: Buffer.from('not a picture').toString('base64'),
  });
  assert.equal(errorOf(canvas, 'req-not-png').code, 'invalid_input');

  const png = CANVAS_PNG.toString('base64');
  await canvas.handle({ type: 'canvas.saveCover', requestId: 'req-save', canvasId, png });
  assert.deepEqual(okReply(canvas, 'req-save'), { kind: 'ok' });
  assert.deepEqual(await readCover('req-saved'), { kind: 'cover', png });

  // The cover sits in the canvas's directory without making it unreadable.
  await canvas.workspace.close();
  const reopened = await harness(t, { root: canvas.root });
  assert.deepEqual(await readCover('req-reopened', reopened), { kind: 'cover', png });

  const { sequence } = reopened.workspace.snapshot(canvasId);
  await reopened.workspace.removeCanvas(canvasId, sequence, [APP]);
  await reopened.handle({ type: 'canvas.readCover', requestId: 'req-removed', canvasId });
  assert.equal(errorOf(reopened, 'req-removed').code, 'invalid_input');
});
