import assert from 'node:assert/strict';
import test from 'node:test';
import type { Annotation } from './annotationProtocol';
import {
  boxBetween,
  draftOf,
  draggedDraft,
  extendStroke,
  linePath,
  movedDraft,
  resizedDraft,
  textSizePx,
} from './annotationGeometry';

test('a drag makes the shape its tool draws, and a press that never moved makes none', () => {
  const from = { x: 40, y: 30 };
  const to = { x: 10, y: 90 };

  assert.deepEqual(draggedDraft('rect', { id: 'a', color: 'red' }, from, to, 1), {
    id: 'a',
    color: 'red',
    kind: 'rect',
    rect: { x: 10, y: 30, width: 30, height: 60 },
  });
  assert.deepEqual(draggedDraft('arrow', { id: 'a', color: 'blue' }, from, to, 1), {
    id: 'a',
    color: 'blue',
    kind: 'line',
    points: [from, to],
    arrowStart: false,
    arrowEnd: true,
  });
  assert.equal(draggedDraft('ellipse', { id: 'a', color: 'red' }, from, null, 1), null);
  // A click with the note tool places a note of screen size, so a half-zoomed
  // board gets one twice as large in board pixels.
  assert.deepEqual(draggedDraft('note', { id: 'a', color: 'yellow' }, from, null, 0.5), {
    id: 'a',
    color: 'yellow',
    kind: 'note',
    rect: { x: 40, y: 30, width: 400, height: 320 },
    text: '',
  });
});

test('a box is never empty and never leaves the bounds the sidecar saves', () => {
  assert.deepEqual(boxBetween({ x: 5, y: 5 }, { x: 5, y: 5 }), { x: 5, y: 5, width: 1, height: 1 });
  const far = boxBetween({ x: -2e7, y: 0 }, { x: 1e6, y: 70_000 });
  assert.equal(far.x, -10_000_000);
  assert.equal(far.width, 65_536);
  assert.equal(far.height, 65_536);
});

test('a resize keeps the opposite corner, and a line handle keeps the other end', () => {
  const box = draggedDraft('rect', { id: 'a', color: 'red' }, { x: 0, y: 0 }, { x: 100, y: 50 }, 1);
  assert.ok(box);
  assert.deepEqual(resizedDraft(box, 'nw', { x: 20, y: 10 }), {
    ...box,
    rect: { x: 20, y: 10, width: 80, height: 40 },
  });
  // Dragged past the fixed corner, the box turns over instead of going negative.
  assert.deepEqual(resizedDraft(box, 'se', { x: -150, y: 0 }), {
    ...box,
    rect: { x: -50, y: 0, width: 50, height: 50 },
  });
  const line = draggedDraft('line', { id: 'b', color: 'ink' }, { x: 0, y: 0 }, { x: 10, y: 10 }, 1);
  assert.ok(line);
  assert.deepEqual(resizedDraft(line, 'end', { x: 5, y: -5 }), {
    ...line,
    points: [
      { x: 0, y: 0 },
      { x: 15, y: 5 },
    ],
  });
  assert.deepEqual(movedDraft(line, { x: 1, y: 2 }), {
    ...line,
    points: [
      { x: 1, y: 2 },
      { x: 11, y: 12 },
    ],
  });
});

test('a stroke at the drawn-point budget thins evenly instead of ending', () => {
  let points = [{ x: 0, y: 0 }];
  for (let at = 1; at < 2048; at += 1) points = extendStroke(points, { x: at, y: 0 });
  assert.equal(points.length, 2048);
  assert.equal(extendStroke(points, { x: 2047, y: 0 }), points, 'a repeated point adds nothing');
  const thinned = extendStroke(points, { x: 5000, y: 0 });
  assert.equal(thinned.length, 1025);
  assert.deepEqual(thinned.at(-1), { x: 5000, y: 0 });
});

test('the box sets a note’s type size, and a label fills its height line by line', () => {
  const rect = { x: 0, y: 0, width: 280, height: 180 };
  assert.equal(textSizePx({ id: 'n', color: 'ink', kind: 'note', rect, text: 'Hi' }), 20);
  const label = { id: 't', color: 'ink', kind: 'text', rect: { ...rect, height: 52 } } as const;
  assert.equal(textSizePx({ ...label, text: 'One' }), 40);
  assert.equal(textSizePx({ ...label, text: 'One\nTwo' }), 20);
});

test('an arrowhead caps the end it is asked for', () => {
  const plain = linePath(
    [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
    ],
    false,
    false,
    4,
  );
  const capped = linePath(
    [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
    ],
    false,
    true,
    4,
  );
  assert.equal(plain, 'M0 0 L10 0');
  assert.match(capped, /^M0 0 L10 0 M[\d.]+ [\d.-]+ L10 0 L[\d.]+ [\d.-]+$/);
});

test('a saved annotation sends back only what the board draws', () => {
  const saved: Annotation = {
    id: 'a',
    color: 'green',
    kind: 'path',
    points: [
      { x: 0, y: 0 },
      { x: 1, y: 1 },
    ],
    author: { kind: 'agent', chatId: 'chat_1' },
    createdAt: 1,
    updatedAt: 2,
  };
  assert.deepEqual(draftOf(saved), { id: 'a', color: 'green', kind: 'path', points: saved.points });
});
