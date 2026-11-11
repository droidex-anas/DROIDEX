import assert from 'node:assert/strict';
import test from 'node:test';
import type { Annotation } from './annotationProtocol';
import { applyCanvasChange } from './applyCanvasChange';
import type { CanvasFrame, CanvasSnapshot, ChangedFrame } from './protocol';

const designSystem = { id: 'droidex', version: 1, mode: 'light' } as const;

function fields(designId: string, revisionId: string | null = null): ChangedFrame {
  return {
    designId,
    name: designId,
    rect: { x: 0, y: 0, width: 720, height: 720 },
    layoutVersion: 0,
    manifestVersion: 0,
    revisionId,
    designSystem,
    variantOf: null,
    seededRevisionId: null,
    hidden: false,
  };
}

function frame(designId: string, revisionId: string | null = null): CanvasFrame {
  return { ...fields(designId, revisionId), build: { status: 'pending', generation: 0 } };
}

function applied(...args: Parameters<typeof applyCanvasChange>): CanvasSnapshot {
  const next = applyCanvasChange(...args);
  assert.ok(next);
  return next;
}

const snapshot: CanvasSnapshot = {
  canvasId: 'cv_01',
  sequence: 4,
  frames: [frame('hey'), frame('cards')],
  annotationsVersion: 2,
  annotations: [],
};

test('a change replaces frames in place, drops removals and appends new frames', () => {
  const next = applied(snapshot, {
    canvasId: 'cv_01',
    sequence: 5,
    frames: [fields('cards', 'rev_09'), fields('cta')],
    builds: [{ designId: 'cta', build: { status: 'pending', generation: 0 } }],
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

test('a frame keeps its build, the same object, until a change sends one, which can come alone', () => {
  const moved = applied(snapshot, {
    canvasId: 'cv_01',
    sequence: 5,
    frames: [{ ...fields('hey'), rect: { x: 40, y: 0, width: 720, height: 720 } }],
    builds: [],
    removedDesignIds: [],
  });
  assert.equal(moved.frames[0].rect.x, 40);
  assert.equal(moved.frames[0].build, snapshot.frames[0].build);
  const built = applied(moved, {
    canvasId: 'cv_01',
    sequence: 6,
    frames: [],
    builds: [
      { designId: 'cards', build: { status: 'building', revisionId: 'rev_02', generation: 1 } },
    ],
    removedDesignIds: [],
  });
  assert.deepEqual(
    built.frames.map((entry) => [entry.designId, entry.build.status]),
    [
      ['hey', 'pending'],
      ['cards', 'building'],
    ],
  );
  assert.equal(built.frames[0], moved.frames[0]);
});

test('a change that touches nothing still advances the sequence', () => {
  const next = applied(snapshot, {
    canvasId: 'cv_01',
    sequence: 5,
    frames: [],
    builds: [],
    removedDesignIds: [],
  });
  assert.equal(next.sequence, 5);
  assert.deepEqual(next.frames, snapshot.frames);
});

test('a removed frame stays removed even when the change also reports it', () => {
  const next = applied(snapshot, {
    canvasId: 'cv_01',
    sequence: 5,
    frames: [fields('hey', 'rev_09')],
    builds: [],
    removedDesignIds: ['hey'],
  });
  assert.deepEqual(
    next.frames.map((entry) => entry.designId),
    ['cards'],
  );
});
test('an annotate change redraws in place, drops removals, stacks new marks and moves the version', () => {
  const mark = (id: string, color: 'ink' | 'red'): Annotation => ({
    id,
    kind: 'rect',
    color,
    rect: { x: 0, y: 0, width: 40, height: 40 },
    author: { kind: 'user' },
    createdAt: 1,
    updatedAt: 1,
  });
  const drawn = {
    ...snapshot,
    annotations: [mark('a', 'ink'), mark('b', 'ink'), mark('c', 'ink')],
  };
  const next = applied(drawn, {
    canvasId: 'cv_01',
    sequence: 5,
    frames: [],
    builds: [],
    removedDesignIds: [],
    annotations: { version: 3, upserted: [mark('d', 'ink'), mark('b', 'red')], removedIds: ['a'] },
  });
  assert.equal(next.annotationsVersion, 3);
  assert.deepEqual(
    next.annotations.map((entry) => `${entry.id}:${entry.color}`),
    ['b:red', 'c:ink', 'd:ink'],
  );
  // A frame change leaves the layer and its version alone.
  const moved = applied(next, {
    canvasId: 'cv_01',
    sequence: 6,
    frames: [fields('hey', 'rev_10')],
    builds: [],
    removedDesignIds: [],
  });
  assert.equal(moved.annotationsVersion, 3);
  assert.equal(moved.annotations, next.annotations);
});

test('a reorder restacks the frames it names, back to front', () => {
  const next = applied(
    { ...snapshot, frames: [frame('hey'), frame('cards'), frame('cta')] },
    {
      canvasId: 'cv_01',
      sequence: 5,
      frames: [],
      builds: [],
      removedDesignIds: [],
      order: ['cta', 'hey'],
    },
  );
  // A frame the order does not name, such as one created since, keeps the front.
  assert.deepEqual(
    next.frames.map((entry) => entry.designId),
    ['cta', 'hey', 'cards'],
  );
});
