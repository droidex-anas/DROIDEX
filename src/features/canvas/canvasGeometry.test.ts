import assert from 'node:assert/strict';
import test from 'node:test';
import {
  MAX_FRAME_PX,
  MAX_SCALE,
  MIN_FRAME_PX,
  MIN_SCALE,
  alignRects,
  applyFrameHandle,
  canvasToScreen,
  distributeRects,
  fitFrames,
  framesInBand,
  interpolateViewport,
  arrowDirection,
  nudgeStep,
  reduceFrameDrag,
  screenToCanvas,
  visibleDesignIds,
  wheelZoomScale,
  zoomAtPoint,
  type FrameDrag,
  type FrameDragEvent,
  type FrameHandle,
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

  // 72 px of padding each side leaves 856 px for a 3000 px span.
  assert.ok(Math.abs(wide.scale - 856 / 3000) < 1e-12);
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
  assert.deepEqual(applyFrameHandle(start, 'move', { x: 60, y: -30 }, 0.5), {
    x: 220,
    y: -10,
    width: 400,
    height: 300,
  });
  // Double zoom: the same 60 screen pixels is 30 world units.
  assert.deepEqual(applyFrameHandle(start, 'move', { x: 60, y: -30 }, 2), {
    x: 130,
    y: 35,
    width: 400,
    height: 300,
  });
  // Either way the frame's screen position moves exactly with the pointer.
  for (const scale of [0.5, 2]) {
    const viewport: Viewport = { x: 10, y: 20, scale };
    const moved = applyFrameHandle(start, 'move', { x: 60, y: -30 }, scale);
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

/** The rect a dragged frame starts from, as the last snapshot acknowledged it. */
const DRAGGED = rect(100, 50);

/** Walks one drag through its moves and reports every rect it committed. */
function runDrag(
  pointers: { x: number; y: number }[],
  scale: number,
  ending: 'release' | 'cancel',
  handle: FrameHandle = 'move',
): { commits: FrameRect[]; drag: FrameDrag | null } {
  let drag: FrameDrag | null = {
    designId: 'dsg_hey',
    pointerId: 1,
    handle,
    expectedLayoutVersion: 3,
    origin: { x: 200, y: 200 },
    startRect: DRAGGED,
    rect: DRAGGED,
  };
  const commits: FrameRect[] = [];
  const step = (event: FrameDragEvent) => {
    const next = reduceFrameDrag(drag, event);
    drag = next.drag;
    if (next.commit) commits.push(next.commit);
  };

  for (const pointer of pointers) step({ type: 'move', pointerId: 1, pointer, scale });
  // The end of the gesture, and then the same end again: a pointerup followed
  // by a lost pointer capture must not write layout twice.
  const end: FrameDragEvent =
    ending === 'release' ? { type: 'release', pointerId: 1 } : { type: 'cancel' };
  step(end);
  step(end);
  return { commits, drag };
}

test('a drag commits once, on release, with the rect the hand left it at', () => {
  const { commits, drag } = runDrag(
    [
      { x: 260, y: 200 },
      { x: 300, y: 240 },
      { x: 320, y: 260 },
    ],
    1,
    'release',
  );

  // No move wrote layout, and the one release wrote it exactly once.
  assert.equal(commits.length, 1);
  assert.deepEqual(commits[0], { x: 220, y: 110, width: 400, height: 300 });
  assert.equal(drag, null);
});

test('a drag that ends where it began commits nothing', () => {
  const { commits } = runDrag(
    [
      { x: 260, y: 240 },
      { x: 200, y: 200 },
    ],
    1,
    'release',
  );
  assert.deepEqual(commits, []);
});

test('the committed rect follows the hand 1:1 at half and double zoom', () => {
  // 60 screen pixels right and 40 down, read at each zoom.
  const pointers = [{ x: 260, y: 240 }];
  assert.deepEqual(runDrag(pointers, 0.5, 'release').commits, [
    { x: 220, y: 130, width: 400, height: 300 },
  ]);
  assert.deepEqual(runDrag(pointers, 2, 'release').commits, [
    { x: 130, y: 70, width: 400, height: 300 },
  ]);
});

test('a cancelled drag commits nothing and ends the gesture', () => {
  const { commits, drag } = runDrag(
    [
      { x: 260, y: 200 },
      { x: 400, y: 600 },
    ],
    1,
    'cancel',
  );
  assert.deepEqual(commits, []);
  assert.equal(drag, null);
});

test('a second pointer cannot move or finish the drag in progress', () => {
  const held: FrameDrag = {
    designId: 'dsg_hey',
    pointerId: 1,
    handle: 'move',
    expectedLayoutVersion: 3,
    origin: { x: 200, y: 200 },
    startRect: DRAGGED,
    rect: { ...DRAGGED, x: 180 },
  };

  const moved = reduceFrameDrag(held, {
    type: 'move',
    pointerId: 9,
    pointer: { x: 999, y: 999 },
    scale: 1,
  });
  assert.equal(moved.drag, held);
  assert.equal(moved.commit, null);

  const released = reduceFrameDrag(held, { type: 'release', pointerId: 9 });
  assert.equal(released.drag, held);
  assert.equal(released.commit, null);
});

test('a resize changes the frame viewport by the edge it was taken by', () => {
  const start = rect(100, 50, 400, 300);

  // The east edge is width only, the south edge height only, the corner both.
  assert.deepEqual(applyFrameHandle(start, 'east', { x: 100, y: 999 }, 1), rect(100, 50, 500, 300));
  assert.deepEqual(applyFrameHandle(start, 'south', { x: 999, y: 60 }, 1), rect(100, 50, 400, 360));
  assert.deepEqual(
    applyFrameHandle(start, 'southeast', { x: 100, y: 60 }, 1),
    rect(100, 50, 500, 360),
  );
  // The frame's own position never moves, whatever edge is pulled.
  for (const handle of ['east', 'south', 'southeast'] as const) {
    const resized = applyFrameHandle(start, handle, { x: -40, y: -40 }, 1);
    assert.equal(resized.x, start.x);
    assert.equal(resized.y, start.y);
  }
  // At half zoom 100 screen pixels is 200 world units of width.
  assert.equal(applyFrameHandle(start, 'east', { x: 100, y: 0 }, 0.5).width, 600);
});

test('a resize stays inside the dimensions the sidecar will accept', () => {
  const start = rect(0, 0, 400, 300);

  assert.deepEqual(
    applyFrameHandle(start, 'southeast', { x: -9999, y: -9999 }, 1),
    rect(0, 0, MIN_FRAME_PX, MIN_FRAME_PX),
  );
  assert.deepEqual(
    applyFrameHandle(start, 'southeast', { x: 99_999, y: 99_999 }, 1),
    rect(0, 0, MAX_FRAME_PX, MAX_FRAME_PX),
  );
});

test('a resize commits once on release and a cancelled one commits nothing', () => {
  const widened = runDrag([{ x: 260, y: 200 }], 1, 'release', 'east');
  assert.deepEqual(widened.commits, [rect(100, 50, 460, 300)]);

  // A resize that ends at the width it started from is not a change.
  assert.deepEqual(
    runDrag(
      [
        { x: 260, y: 200 },
        { x: 200, y: 200 },
      ],
      1,
      'release',
      'east',
    ).commits,
    [],
  );
  assert.deepEqual(runDrag([{ x: 320, y: 300 }], 1, 'cancel', 'southeast').commits, []);
});

/** Three frames of different sizes, which is what makes align worth testing. */
const SPREAD = [rect(0, 0, 100, 40), rect(200, 100, 300, 80), rect(600, 300, 60, 200)];

test('align brings a selection onto the edge of its own bounds', () => {
  assert.deepEqual(
    alignRects(SPREAD, 'left').map(({ x }) => x),
    [0, 0, 0],
  );
  assert.deepEqual(
    alignRects(SPREAD, 'right').map(({ x }) => x),
    [560, 360, 600],
  );
  // The bounds run 0–660, so each frame centres on 330.
  assert.deepEqual(
    alignRects(SPREAD, 'centerX').map(({ x, width }) => x + width / 2),
    [330, 330, 330],
  );
  assert.deepEqual(
    alignRects(SPREAD, 'top').map(({ y }) => y),
    [0, 0, 0],
  );
  assert.deepEqual(
    alignRects(SPREAD, 'bottom').map(({ y, height }) => y + height),
    [500, 500, 500],
  );
  assert.deepEqual(
    alignRects(SPREAD, 'centerY').map(({ y, height }) => y + height / 2),
    [250, 250, 250],
  );

  // Align moves frames and never resizes them, and leaves the other axis be.
  for (const edge of ['left', 'centerX', 'right'] as const)
    assert.deepEqual(
      alignRects(SPREAD, edge).map(({ y, width, height }) => [y, width, height]),
      SPREAD.map(({ y, width, height }) => [y, width, height]),
    );
  assert.deepEqual(alignRects([], 'left'), []);
});

test('distribute leaves the outermost frames and makes every gap equal', () => {
  // Widths 100 + 300 + 60 cover 460 of the 660 span, so three frames leave
  // 200 of space in two gaps of 100.
  const spread = distributeRects(SPREAD, 'horizontal');
  assert.deepEqual(
    spread.map(({ x }) => x),
    [0, 200, 600],
  );
  const gaps = [
    spread[1].x - (spread[0].x + spread[0].width),
    spread[2].x - (spread[1].x + spread[1].width),
  ];
  assert.deepEqual(gaps, [100, 100]);

  // The order given is the order returned, whatever order the frames sit in.
  const scrambled = [SPREAD[2], SPREAD[0], SPREAD[1]];
  const sorted = distributeRects(scrambled, 'horizontal');
  assert.deepEqual(
    sorted.map(({ width }) => width),
    scrambled.map(({ width }) => width),
  );
  assert.deepEqual(
    sorted.map(({ x }) => x),
    [600, 0, 200],
  );

  // Vertical uses heights the same way: 40 + 80 + 200 of a 500 span.
  const down = distributeRects(SPREAD, 'vertical');
  assert.deepEqual(
    down.map(({ y }) => y),
    [0, 130, 300],
  );

  // Fewer than three frames, and frames that already overlap their own bounds,
  // have nothing to spread.
  assert.deepEqual(distributeRects(SPREAD.slice(0, 2), 'horizontal'), SPREAD.slice(0, 2));
  const crowded = [rect(0, 0, 400, 40), rect(10, 0, 400, 40), rect(20, 0, 400, 40)];
  assert.deepEqual(distributeRects(crowded, 'horizontal'), crowded);
});

/** A board of frames at known world positions, for the two screen queries. */
const PLACED = [
  { designId: 'near', rect: rect(0, 0, 100, 100) },
  { designId: 'right', rect: rect(400, 0, 100, 100) },
  { designId: 'far', rect: rect(5000, 5000, 100, 100) },
];

test('a rubber band picks up the frames it touches, in either direction', () => {
  const viewport: Viewport = { x: 0, y: 0, scale: 1 };

  assert.deepEqual(framesInBand(PLACED, viewport, { x: -10, y: -10 }, { x: 450, y: 50 }), [
    'near',
    'right',
  ]);
  // Drawn the other way the band covers the same frames.
  assert.deepEqual(framesInBand(PLACED, viewport, { x: 450, y: 50 }, { x: -10, y: -10 }), [
    'near',
    'right',
  ]);
  // Touching one pixel of a frame is touching it; missing it entirely is not.
  assert.deepEqual(framesInBand(PLACED, viewport, { x: 99, y: 99 }, { x: 150, y: 150 }), ['near']);
  assert.deepEqual(framesInBand(PLACED, viewport, { x: 200, y: 200 }, { x: 300, y: 300 }), []);

  // The band is in screen pixels, so a zoomed-out board catches more world.
  assert.deepEqual(
    framesInBand(PLACED, { x: 0, y: 0, scale: 0.1 }, { x: 0, y: 0 }, { x: 60, y: 60 }),
    ['near', 'right'],
  );
});

test('only the frames in the board box compete for a live slot, nearest first', () => {
  const box = { x: 600, y: 400 };

  // Both of the two are inside the box and the far one is nowhere near it. The
  // board's centre is world (300, 200), which 'right' sits closer to.
  assert.deepEqual(visibleDesignIds(PLACED, { x: 0, y: 0, scale: 1 }, box), ['right', 'near']);
  // Panning the board right brings 'near' under the centre and 'right' away
  // from it, which reverses who claims a slot first.
  assert.deepEqual(visibleDesignIds(PLACED, { x: 150, y: 0, scale: 1 }, box), ['near', 'right']);
  // A board with nothing measured yet has nothing visible.
  assert.deepEqual(visibleDesignIds(PLACED, { x: 0, y: 0, scale: 1 }, { x: 0, y: 0 }), []);
});

test('an arrow key nudges by one world unit, and by ten with Shift', () => {
  const left = arrowDirection('ArrowLeft');
  const down = arrowDirection('ArrowDown');
  assert.deepEqual(left, { x: -1, y: 0 });
  assert.deepEqual(arrowDirection('ArrowRight'), { x: 1, y: 0 });
  assert.deepEqual(arrowDirection('ArrowUp'), { x: 0, y: -1 });
  assert.ok(left && down);

  assert.deepEqual(nudgeStep(left, false), { x: -1, y: 0 });
  assert.deepEqual(nudgeStep(left, true), { x: -10, y: 0 });
  assert.deepEqual(nudgeStep(down, true), { x: 0, y: 10 });

  // Every other key belongs to whatever else is listening for it.
  assert.equal(arrowDirection('Enter'), null);
  assert.equal(arrowDirection('a'), null);
});
