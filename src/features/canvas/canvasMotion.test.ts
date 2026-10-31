import assert from 'node:assert/strict';
import test from 'node:test';

import { canvasActivity, canvasMotion, motionFor, type CanvasActivityStage } from './canvasMotion';

// Typed as a full record so adding a stage without deciding its bloom fails
// typecheck rather than silently inheriting a neighbour's behavior.
const expectedBloom: Record<CanvasActivityStage, boolean> = {
  queued: false,
  writing: true,
  building: true,
  ready: false,
  failed: false,
  cancelled: false,
};

test('reduced motion zeroes every duration and distance token', () => {
  const reduced = motionFor(true);
  const measured = Object.keys(canvasMotion).filter(
    (token) => token.endsWith('Ms') || token.endsWith('Px'),
  );
  assert.ok(measured.length > 0);
  for (const token of measured) {
    const key = token as keyof typeof canvasMotion;
    assert.ok((canvasMotion[key] as number) > 0, `${token} should have a default duration`);
    assert.equal(reduced[key], 0, `${token} should be immediate under reduced motion`);
  }
  assert.deepEqual(reduced.ease, canvasMotion.ease);
  assert.equal(reduced.easeCss, canvasMotion.easeCss);
});

test('full motion keeps the spec timings', () => {
  assert.equal(motionFor(false), canvasMotion);
  assert.deepEqual(
    {
      focusMs: canvasMotion.focusMs,
      popoverMs: canvasMotion.popoverMs,
      frameArrivalMs: canvasMotion.frameArrivalMs,
      readyMs: canvasMotion.readyMs,
      presenceMs: canvasMotion.presenceMs,
      busyLoopMs: canvasMotion.busyLoopMs,
    },
    {
      focusMs: 220,
      popoverMs: 120,
      frameArrivalMs: 180,
      readyMs: 120,
      presenceMs: 140,
      busyLoopMs: 1600,
    },
  );
  assert.ok(canvasMotion.paneMs >= 180 && canvasMotion.paneMs <= 220);
});

test('every activity stage decides its own label and bloom', () => {
  assert.deepEqual(Object.keys(canvasActivity).sort(), Object.keys(expectedBloom).sort());
  for (const [stage, bloom] of Object.entries(expectedBloom)) {
    const activity = canvasActivity[stage as CanvasActivityStage];
    assert.equal(activity.bloom, bloom, `${stage} bloom`);
    assert.ok(activity.label.length > 0, `${stage} label`);
  }
});
