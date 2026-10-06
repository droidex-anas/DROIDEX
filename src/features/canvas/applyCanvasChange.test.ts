import assert from 'node:assert/strict';
import test from 'node:test';
import { applyCanvasChange } from './applyCanvasChange';
import type { CanvasFrame, CanvasSnapshot } from './protocol';

const designSystem = { id: 'droidex', version: 1, mode: 'light' } as const;

function frame(designId: string, revisionId: string | null = null): CanvasFrame {
  return {
    designId,
    name: designId,
    rect: { x: 0, y: 0, width: 720, height: 720 },
    layoutVersion: 0,
    revisionId,
    designSystem,
    build: { status: 'pending' },
  };
}

const snapshot: CanvasSnapshot = {
  canvasId: 'cv_01',
  sequence: 4,
  frames: [frame('hey'), frame('cards')],
};

test('a change replaces frames in place, drops removals and appends new frames', () => {
  const next = applyCanvasChange(snapshot, {
    canvasId: 'cv_01',
    sequence: 5,
    frames: [frame('cards', 'rev_09'), frame('cta')],
    removedDesignIds: ['hey'],
  });
  assert.equal(next.sequence, 5);
  assert.deepEqual(
    next.frames.map((entry) => [entry.designId, entry.revisionId]),
    [
      ['cards', 'rev_09'],
      ['cta', null],
    ],
  );
  // The snapshot it extended is untouched, so a caller can keep the old one.
  assert.deepEqual(
    snapshot.frames.map((entry) => entry.designId),
    ['hey', 'cards'],
  );
});

test('a change that touches nothing still advances the sequence', () => {
  const next = applyCanvasChange(snapshot, {
    canvasId: 'cv_01',
    sequence: 5,
    frames: [],
    removedDesignIds: [],
  });
  assert.equal(next.sequence, 5);
  assert.deepEqual(next.frames, snapshot.frames);
});

test('a removed frame stays removed even when the change also reports it', () => {
  const next = applyCanvasChange(snapshot, {
    canvasId: 'cv_01',
    sequence: 5,
    frames: [frame('hey', 'rev_09')],
    removedDesignIds: ['hey'],
  });
  assert.deepEqual(
    next.frames.map((entry) => entry.designId),
    ['cards'],
  );
});
