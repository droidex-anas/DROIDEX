import assert from 'node:assert/strict';
import test from 'node:test';
import { MIN_FRAME_PX } from './canvasGeometry';
import { snapFrameRect, snapGroupMove } from './frameSnap';
import type { FrameRect } from './protocol';

function rect(x: number, y: number, width: number, height: number): FrameRect {
  return { x, y, width, height };
}

/** A frame other frames snap to, its lines at x 0, 200, 400 and y 0, 150, 300. */
const ANCHOR = rect(0, 0, 400, 300);

test('a moved frame snaps its left, centre or right onto another frame within six screen pixels', () => {
  // Left onto the anchor's right, centre onto its centre, right onto its right.
  assert.equal(snapFrameRect(rect(404, 500, 200, 100), 'move', [ANCHOR], 1).rect.x, 400);
  assert.equal(snapFrameRect(rect(103, 500, 200, 100), 'move', [ANCHOR], 1).rect.x, 100);
  assert.equal(snapFrameRect(rect(236, 500, 160, 100), 'move', [ANCHOR], 1).rect.x, 240);

  // Top onto the anchor's bottom, on the other axis in the same move.
  const both = snapFrameRect(rect(403, 297, 200, 100), 'move', [ANCHOR], 1);
  assert.deepEqual(both.rect, rect(400, 300, 200, 100));
  // Each line runs through both frames, across the span they cover together.
  assert.deepEqual(both.guides, [
    { axis: 'x', at: 400, from: 0, to: 400 },
    { axis: 'y', at: 300, from: 0, to: 600 },
  ]);
});

test('the snap distance is in screen pixels, so it covers more of the world zoomed out', () => {
  const tenAway = rect(410, 500, 200, 100);
  assert.equal(snapFrameRect(tenAway, 'move', [ANCHOR], 1).rect.x, 410);
  assert.equal(snapFrameRect(tenAway, 'move', [ANCHOR], 0.5).rect.x, 400);
  // Zoomed in, four world units are eight screen pixels: too far to pull.
  assert.equal(snapFrameRect(rect(404, 500, 200, 100), 'move', [ANCHOR], 2).rect.x, 404);
});

test('a frame with nothing near it moves freely and draws no lines', () => {
  const free = snapFrameRect(rect(700, 900, 200, 100), 'move', [ANCHOR], 1);
  assert.deepEqual(free, { rect: rect(700, 900, 200, 100), guides: [], gaps: [] });
});

test('a moved selection snaps on its bounds, and each frame keeps its place in it', () => {
  // The pair spans x 0 to 300; carried 103 right, its right edge is 3 past the anchor's.
  const pair = [rect(0, 500, 100, 100), rect(150, 520, 150, 80)];
  const moved = snapGroupMove(pair, { x: 103, y: 0 }, [ANCHOR], 1);

  assert.deepEqual(moved.rects, [rect(100, 500, 100, 100), rect(250, 520, 150, 80)]);
  assert.deepEqual(moved.guides, [{ axis: 'x', at: 400, from: 0, to: 600 }]);
});

test('a resize snaps only the edge in the hand', () => {
  const neighbour = rect(600, 0, 400, 300);

  // The east edge reaches the neighbour; the bottom, two pixels off its own
  // bottom, is not being pulled and stays.
  const east = snapFrameRect(rect(0, 0, 596, 302), 'east', [neighbour], 1);
  assert.deepEqual(east.rect, rect(0, 0, 600, 302));
  assert.deepEqual(east.guides, [{ axis: 'x', at: 600, from: 0, to: 302 }]);
  assert.deepEqual(east.gaps, []);

  assert.deepEqual(
    snapFrameRect(rect(0, 0, 596, 302), 'south', [neighbour], 1).rect,
    rect(0, 0, 596, 300),
  );
  assert.deepEqual(
    snapFrameRect(rect(0, 0, 596, 302), 'southeast', [neighbour], 1).rect,
    rect(0, 0, 600, 300),
  );

  // The left edge three pixels off the anchor's is not held, so it never moves.
  const below = rect(0, 400, 200, 100);
  assert.deepEqual(
    snapFrameRect(rect(3, 0, 330, 300), 'east', [below], 1).rect,
    rect(3, 0, 330, 300),
  );
});

test('a resize never snaps a frame below the smallest size', () => {
  const marker = rect(MIN_FRAME_PX - 2, 400, 100, 100);
  const resized = snapFrameRect(rect(0, 0, MIN_FRAME_PX + 4, 300), 'east', [marker], 1);
  assert.equal(resized.rect.width, MIN_FRAME_PX);
  assert.deepEqual(resized.guides, []);
});

test('a frame between two neighbours settles at equal spacing and names both gaps', () => {
  const left = rect(0, 0, 100, 100);
  const right = rect(400, 0, 100, 100);
  const middle = snapFrameRect(rect(197, 20, 100, 60), 'move', [left, right], 1);

  assert.equal(middle.rect.x, 200);
  assert.deepEqual(middle.gaps, [
    { axis: 'x', from: 100, to: 200, at: 50 },
    { axis: 'x', from: 300, to: 400, at: 50 },
  ]);
});

test('a frame joining a row takes the spacing the row already has', () => {
  const first = rect(0, 0, 100, 100);
  const second = rect(180, 0, 100, 100);
  const third = snapFrameRect(rect(362, 0, 100, 100), 'move', [first, second], 1);

  assert.equal(third.rect.x, 360);
  assert.deepEqual(third.gaps, [
    { axis: 'x', from: 280, to: 360, at: 50 },
    { axis: 'x', from: 100, to: 180, at: 50 },
  ]);
});

test('the space to a neighbour shows only while the frame lines up with it', () => {
  const neighbour = rect(0, 0, 100, 100);

  const level = snapFrameRect(rect(250, 0, 100, 60), 'move', [neighbour], 1);
  assert.deepEqual(level.gaps, [{ axis: 'x', from: 100, to: 250, at: 30 }]);

  const offset = snapFrameRect(rect(250, 10, 100, 30), 'move', [neighbour], 1);
  assert.deepEqual(offset, { rect: rect(250, 10, 100, 30), guides: [], gaps: [] });
});

test('a snap onto a half-pixel centre still lands on whole pixels', () => {
  const odd = rect(0, 0, 101, 100);
  // The centre, 1.5 off the odd frame's 50.5, is the nearest line.
  const snapped = snapFrameRect(rect(32, 300, 40, 100), 'move', [odd], 1);

  for (const value of Object.values(snapped.rect)) assert.ok(Number.isInteger(value));
  assert.deepEqual(
    snapped.guides.map(({ axis, at }) => ({ axis, at })),
    [{ axis: 'x', at: 50.5 }],
  );
});
