import assert from 'node:assert/strict';
import test from 'node:test';
import {
  MAX_SCALE,
  MIN_SCALE,
  canvasToScreen,
  fitFrames,
  interpolateViewport,
  moveRect,
  screenToCanvas,
  wheelZoomScale,
  zoomAtPoint,
  type Viewport,
} from './canvasGeometry';
import type { FrameRect } from './protocol';

function rect(x: number, y: number, width = 400, height = 300): FrameRect {
  return { x, y, width, height };
}

test('the transform round-trips between screen and world at any zoom', () => {
  for (const scale of [0.1, 0.5, 1, 2.4, 4]) {
    const viewport: Viewport = { x: 137, y: -62, scale };
    const screen = { x: 412, y: 268 };
    const back = canvasToScreen(viewport, screenToCanvas(viewport, screen));
    assert.ok(Math.abs(back.x - screen.x) < 1e-9, `x at ${String(scale)}`);
    assert.ok(Math.abs(back.y - screen.y) < 1e-9, `y at ${String(scale)}`);
  }
});

test('zoom keeps the world point under the cursor', () => {
  // The assertion from Task 5 of the plan, which must hold exactly.
  const before: Viewport = { x: 80, y: -20, scale: 0.8 };
  const pointer = { x: 300, y: 240 };
  assert.deepEqual(
    screenToCanvas(zoomAtPoint(before, pointer, 1.6), pointer),
    screenToCanvas(before, pointer),
  );

  // And off the origin, zooming out as well as in.
  const anchor = screenToCanvas(before, { x: 12, y: 505 });
  for (const requested of [0.3, 1, 3.9]) {
    const after = zoomAtPoint(before, { x: 12, y: 505 }, requested);
    const held = screenToCanvas(after, { x: 12, y: 505 });
    assert.ok(Math.abs(held.x - anchor.x) < 1e-9, `x at ${String(requested)}`);
    assert.ok(Math.abs(held.y - anchor.y) < 1e-9, `y at ${String(requested)}`);
  }
});

test('zoom clamps to 0.1-4 and still anchors at the clamped scale', () => {
  const viewport: Viewport = { x: 40, y: 40, scale: 1 };
  const pointer = { x: 200, y: 100 };
  const anchor = screenToCanvas(viewport, pointer);

  for (const [requested, expected] of [
    [0.02, MIN_SCALE],
    [40, MAX_SCALE],
  ] as const) {
    const after = zoomAtPoint(viewport, pointer, requested);
    assert.equal(after.scale, expected);
    assert.deepEqual(screenToCanvas(after, pointer), anchor);
  }
});

test('wheel and pinch zoom are reversible, and pinch is the finer of the two', () => {
  const out = wheelZoomScale(1, 120, false);
  assert.ok(out < 1);
  assert.ok(Math.abs(wheelZoomScale(out, -120, false) - 1) < 1e-12);
  // The same delta from a trackpad pinch moves further than a wheel notch.
  assert.ok(wheelZoomScale(1, 120, true) < out);
});

test('fit centres every frame with padding and never magnifies past 100%', () => {
  const size = { x: 1000, y: 800 };
  const wide = fitFrames([rect(0, 0, 2000, 400), rect(2200, 600, 800, 400)], size);

  // 48 px of padding each side leaves 904 px for a 3000 px span.
  assert.ok(Math.abs(wide.scale - 904 / 3000) < 1e-12);
  // The bounds centre lands on the viewport centre.
  assert.deepEqual(canvasToScreen(wide, { x: 1500, y: 500 }), { x: 500, y: 400 });

  // One small frame reads at its real size instead of filling the board.
  const single = fitFrames([rect(-40, 120, 320, 240)], size);
  assert.equal(single.scale, 1);
  assert.deepEqual(canvasToScreen(single, { x: 120, y: 240 }), { x: 500, y: 400 });

  // Nothing to frame, and a board with no measured size, are both identity.
  assert.deepEqual(fitFrames([], size), { x: 0, y: 0, scale: 1 });
  assert.deepEqual(fitFrames([rect(0, 0)], { x: 0, y: 0 }), { x: 0, y: 0, scale: 1 });
});

test('fit of a very large board clamps to the minimum scale', () => {
  const fitted = fitFrames([rect(0, 0, 400_000, 200_000)], { x: 1000, y: 800 });
  assert.equal(fitted.scale, MIN_SCALE);
});

test('a dragged frame follows the hand 1:1 at any zoom', () => {
  const start = rect(100, 50);

  // Half zoom: 60 screen pixels is 120 world units.
  assert.deepEqual(moveRect(start, { x: 60, y: -30 }, 0.5), {
    x: 220,
    y: -10,
    width: 400,
    height: 300,
  });
  // Double zoom: the same 60 screen pixels is 30 world units.
  assert.deepEqual(moveRect(start, { x: 60, y: -30 }, 2), {
    x: 130,
    y: 35,
    width: 400,
    height: 300,
  });
  // Either way the frame's screen position moves exactly with the pointer.
  for (const scale of [0.5, 2]) {
    const viewport: Viewport = { x: 10, y: 20, scale };
    const moved = moveRect(start, { x: 60, y: -30 }, scale);
    const before = canvasToScreen(viewport, start);
    const after = canvasToScreen(viewport, moved);
    assert.ok(Math.abs(after.x - before.x - 60) < 1e-9, `x at ${String(scale)}`);
    assert.ok(Math.abs(after.y - before.y + 30) < 1e-9, `y at ${String(scale)}`);
  }
});

test('a fit animation starts where it was and ends on the target', () => {
  const from: Viewport = { x: 0, y: 0, scale: 1 };
  const to: Viewport = { x: -200, y: 60, scale: 0.4 };
  assert.deepEqual(interpolateViewport(from, to, 0), from);
  assert.deepEqual(interpolateViewport(from, to, 1), to);
  assert.deepEqual(interpolateViewport(from, to, 0.5), { x: -100, y: 30, scale: 0.7 });
});
