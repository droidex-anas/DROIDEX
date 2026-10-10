import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import {
  captureRequest,
  createCanvas,
  createFrame,
  harness,
  turnScope,
} from '../testing/canvasBridgeSupport.js';
import { CANVAS_PNG } from '../testing/canvasStorageSupport.js';

const png = CANVAS_PNG.toString('base64');

/** A canvas with one frame, read through the real bridge, and a turn lease on it. */
async function canvasWithTurn(t: TestContext) {
  const canvas = await harness(t);
  const canvasId = await createCanvas(canvas);
  const designId = await createFrame(canvas, canvasId);
  const scope = turnScope(canvasId, 'turn:capture');
  canvas.scopes.register(scope);
  const ref = { designId, revisionId: 'rev_current' };
  const capture = () => canvas.capture(canvasId, ref, canvas.scopes.ended(scope.scopeId));
  const report = (captureId: string) =>
    canvas.handle({
      type: 'canvas.reportCapture',
      requestId: `report-${captureId}`,
      captureId,
      capture: { ok: true, png },
    });
  return { canvas, canvasId, designId, scope, capture, report };
}

test('no watching page refuses at once, and a watching page’s PNG of the asked revision is relayed', async (t) => {
  const { canvas, canvasId, designId, capture, report } = await canvasWithTurn(t);

  await assert.rejects(capture(), {
    code: 'capture_unavailable',
    message: /Open this design’s canvas in DROIDEX/,
  });
  assert.equal(
    canvas.events.some((event) => event.type === 'canvas.captureRequest'),
    false,
  );

  await canvas.handle({ type: 'canvas.subscribe', requestId: 'req-watch', canvasId });
  const pending = capture();
  const request = await captureRequest(canvas.events, 0);
  assert.deepEqual(
    [request.canvasId, request.designId, request.revisionId],
    [canvasId, designId, 'rev_current'],
  );
  await report(request.captureId);
  assert.equal(await pending, png);
});

test('a capture fails at its deadline, and ends with its turn even when the page answers later', async (t) => {
  const { canvas, canvasId, scope, capture, report } = await canvasWithTurn(t);
  await canvas.handle({ type: 'canvas.subscribe', requestId: 'req-watch', canvasId });

  t.mock.timers.enable({ apis: ['setTimeout'] });
  const silent = capture();
  await captureRequest(canvas.events, 0);
  t.mock.timers.tick(7_000);
  await assert.rejects(silent, {
    code: 'capture_unavailable',
    message: /did not capture this design in time/,
  });

  const expiring = capture();
  const late = await captureRequest(canvas.events, 1);
  canvas.scopes.revoke(scope.scopeId);
  await report(late.captureId);
  await assert.rejects(expiring, { code: 'scope_expired' });
});
