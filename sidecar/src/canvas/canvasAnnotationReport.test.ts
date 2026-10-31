import assert from 'node:assert/strict';
import test from 'node:test';
import { agentAnnotation } from './canvasAnnotationReport.js';
import type { Annotation } from './canvasAnnotationSchema.js';

// Two 720×520 frames side by side with the default 80px gap.
const frames = [
  { designId: 'dsg_left', rect: { x: 0, y: 0, width: 720, height: 520 } },
  { designId: 'dsg_right', rect: { x: 800, y: 0, width: 720, height: 520 } },
];
const stamp = { author: { kind: 'user' }, createdAt: 1, updatedAt: 1 } as const;

test('an arrow is over the frames it crosses and points at the one its head reaches', () => {
  const arrow: Annotation = {
    id: 'ann_arrow',
    kind: 'line',
    color: 'red',
    points: [
      { x: 100.4, y: 100 },
      { x: 1000.6, y: 100 },
    ],
    arrowStart: false,
    arrowEnd: true,
    ...stamp,
  };
  assert.deepEqual(agentAnnotation(arrow, frames, 'app-1'), {
    id: 'ann_arrow',
    kind: 'line',
    author: 'user',
    color: 'red',
    points: [
      { x: 100, y: 100 },
      { x: 1001, y: 100 },
    ],
    arrowEnd: true,
    over: ['dsg_left', 'dsg_right'],
    pointsAt: 'dsg_right',
  });
  // An arrow into empty board points at nothing, however close its tail is.
  const outward = { ...arrow, points: [arrow.points[0], { x: 300, y: 900 }] };
  assert.equal(agentAnnotation(outward, frames, 'app-1').pointsAt, undefined);
});

test('a note beside a frame is near it, and a loop drawn around a frame is over it', () => {
  const note: Annotation = {
    id: 'ann_note',
    kind: 'note',
    color: 'yellow',
    rect: { x: 1600, y: 40, width: 200, height: 120 },
    text: 'Make this one bigger',
    ...stamp,
  };
  assert.deepEqual(
    [agentAnnotation(note, frames, 'app-1')].map(({ over, near }) => ({ over, near })),
    [{ over: undefined, near: 'dsg_right' }],
  );
  assert.equal(
    agentAnnotation({ ...note, rect: { ...note.rect, x: 2000 } }, frames, 'app-1').near,
    undefined,
  );

  // A loose loop around the left frame, never touching it.
  const corners = [
    { x: -60, y: -60 },
    { x: 780, y: -60 },
    { x: 780, y: 580 },
    { x: -60, y: 580 },
    { x: -40, y: -40 },
  ];
  const loop: Annotation = {
    id: 'ann_loop',
    kind: 'path',
    color: 'blue',
    points: corners,
    author: { kind: 'agent', chatId: 'app-1' },
    createdAt: 1,
    updatedAt: 1,
  };
  const read = agentAnnotation(loop, frames, 'app-1');
  assert.equal(read.author, 'you');
  assert.deepEqual(read.over, ['dsg_left']);
  assert.equal(agentAnnotation(loop, frames, 'app-2').author, 'another chat');
});

test('an ellipse is over only what its own curve reaches, not what its box covers', () => {
  // A round ellipse in the frame's upper-left corner: its box overlaps the
  // frame, its curve misses it.
  const ellipse: Annotation = {
    id: 'ann_ellipse',
    kind: 'ellipse',
    color: 'ink',
    rect: { x: -220, y: -220, width: 240, height: 240 },
    ...stamp,
  };
  assert.deepEqual(
    [agentAnnotation(ellipse, frames, 'app-1')].map(({ over, near }) => ({ over, near })),
    [{ over: undefined, near: 'dsg_left' }],
  );
  // A wider one whose curve does reach into the frame is over it.
  const reaching = { ...ellipse, rect: { x: -220, y: -220, width: 400, height: 400 } };
  assert.deepEqual(agentAnnotation(reaching, frames, 'app-1').over, ['dsg_left']);
});
