// The compare-and-set contract on the renderer's side: which optimistic rects
// the board still draws after a commit, an acknowledgement and a refusal.

import assert from 'node:assert/strict';
import test from 'node:test';
import { NO_PENDING_RECTS, reducePendingRects, type FramePlacement } from './useFrameLayout';
import type { CanvasFrame, FrameRect } from './protocol';

const MOVED: FrameRect = { x: 240, y: 80, width: 400, height: 300 };

function frame(designId: string, layoutVersion: number): CanvasFrame {
  return {
    designId,
    name: `Design ${designId}`,
    rect: MOVED,
    layoutVersion,
    revisionId: 'rev_01',
    designSystem: { id: 'droidex', version: 1, mode: 'dark' },
    build: { status: 'pending', generation: 1 },
  };
}

function placement(designId: string, expectedLayoutVersion: number, rect = MOVED): FramePlacement {
  return { designId, expectedLayoutVersion, rect };
}

test('a committed rect is drawn until the sidecar publishes a newer layout', () => {
  const pending = reducePendingRects(NO_PENDING_RECTS, {
    type: 'commit',
    placements: [placement('a', 3)],
  });
  assert.deepEqual(pending.get('a'), { rect: MOVED, afterLayoutVersion: 3 });

  // The layout version the commit was read at is not an answer to it, so the
  // frame stays where the user left it rather than snapping back for a frame.
  assert.equal(
    reducePendingRects(pending, { type: 'acknowledged', frames: [frame('a', 3)] }),
    pending,
  );

  // Any newer version is the answer, whatever rect that answer settled on —
  // including the refusal that leaves the frame at its acknowledged rect.
  assert.equal(
    reducePendingRects(pending, { type: 'acknowledged', frames: [frame('a', 4)] }).size,
    0,
  );
  // A frame the canvas has lost keeps nothing either.
  assert.equal(reducePendingRects(pending, { type: 'acknowledged', frames: [] }).size, 0);
});

test('a refusal drops its own rects and leaves a rect moved since it went out', () => {
  const refused = [placement('a', 3), placement('b', 1)];
  const committed = reducePendingRects(NO_PENDING_RECTS, { type: 'commit', placements: refused });

  // 'b' was moved again while the first commit was in flight, so the refusal is
  // no longer about the rect the board draws for it.
  const again = placement('b', 1, { x: 900, y: 700, width: 400, height: 300 });
  const later = reducePendingRects(committed, { type: 'commit', placements: [again] });

  const after = reducePendingRects(later, { type: 'refused', placements: refused });
  assert.deepEqual([...after.keys()], ['b']);
  assert.equal(after.get('b')?.rect, again.rect);
});

test('an acknowledgement that answers nothing keeps the same rects', () => {
  const pending = reducePendingRects(NO_PENDING_RECTS, {
    type: 'commit',
    placements: [placement('a', 9)],
  });

  assert.equal(
    reducePendingRects(pending, { type: 'acknowledged', frames: [frame('a', 9)] }),
    pending,
  );
});
