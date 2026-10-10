import assert from 'node:assert/strict';
import test from 'node:test';
import {
  canvasContextOf,
  framePins,
  promptWithFramePins,
  restoreFramePins,
  syncFramePins,
  toggleFramePin,
  unpinFrames,
} from './framePins';
import type { CanvasFrame } from './protocol';

function frame(
  designId: string,
  revisionId: string | null,
  name = `Design ${designId}`,
): CanvasFrame {
  return {
    designId,
    name,
    rect: { x: 0, y: 0, width: 720.4, height: 519.6 },
    layoutVersion: 1,
    manifestVersion: 1,
    revisionId,
    designSystem: { id: 'droidex', version: 2, mode: 'dark' },
    build: { status: 'pending', generation: 1 },
  };
}

test('a frame is pinned once, by the chat that pinned it, and a second press takes it off', () => {
  toggleFramePin('chat-a', 'cv_1', frame('d1', 'r1', 'Pricing · 3 Tiers'));
  toggleFramePin('chat-a', 'cv_1', frame('d2', 'r1'));

  assert.deepEqual(
    framePins('chat-a').map(({ designId, size, name }) => ({ designId, size, name })),
    [
      { designId: 'd1', size: '720 × 520', name: 'Pricing · 3 Tiers' },
      { designId: 'd2', size: '720 × 520', name: 'Design d2' },
    ],
  );
  assert.equal(framePins('chat-b').length, 0);

  toggleFramePin('chat-a', 'cv_1', frame('d1', 'r1'));
  assert.deepEqual(
    framePins('chat-a').map((pin) => pin.designId),
    ['d2'],
  );
  // One request pins one canvas, so a frame from another starts over.
  toggleFramePin('chat-a', 'cv_2', frame('d9', 'r1'));
  assert.deepEqual(
    framePins('chat-a').map((pin) => pin.designId),
    ['d9'],
  );
});

test('a queued request keeps the revisions it was sent with when the pins move on', () => {
  toggleFramePin('chat-q', 'cv_1', frame('d1', 'r1'));
  const queued = framePins('chat-q');

  // The agent revises the frame and the user pins another before the queue drains.
  syncFramePins('chat-q', {
    canvasId: 'cv_1',
    sequence: 2,
    frames: [frame('d1', 'r2'), frame('d2', 'r1')],
  });
  toggleFramePin('chat-q', 'cv_1', frame('d2', 'r1'));

  assert.deepEqual(canvasContextOf(queued), {
    designs: [{ designId: 'd1', revisionId: 'r1' }],
    elements: [],
    designSystem: { id: 'droidex', version: 2, mode: 'dark' },
  });
  assert.deepEqual(canvasContextOf(framePins('chat-q'))?.designs, [
    { designId: 'd1', revisionId: 'r2' },
    { designId: 'd2', revisionId: 'r1' },
  ]);
  assert.equal(canvasContextOf([]), undefined);

  // The model is told which frames before any tool call, in the block the
  // sidecar's canvasFramesFromPrompt splits back out on replay.
  assert.equal(
    promptWithFramePins('Make it bolder', queued),
    [
      'Make it bolder',
      '',
      '<canvas_frames>',
      'The user pinned these canvas frames to this request; "this" and "it" mean them.',
      '<frame id="d1">Design d1</frame>',
      '</canvas_frames>',
    ].join('\n'),
  );
  assert.equal(promptWithFramePins('Make it bolder', []), 'Make it bolder');
});

test('pins follow the attached canvas, and an edited queued prompt brings its own back', () => {
  toggleFramePin('chat-s', 'cv_1', frame('d1', 'r1'));
  toggleFramePin('chat-s', 'cv_1', frame('d2', 'r1'));
  const before = framePins('chat-s');

  // d2 was deleted from the board; d1 is as it was.
  syncFramePins('chat-s', { canvasId: 'cv_1', sequence: 3, frames: [frame('d1', 'r1')] });
  assert.deepEqual(
    framePins('chat-s').map((pin) => pin.designId),
    ['d1'],
  );
  const unchanged = framePins('chat-s');
  syncFramePins('chat-s', { canvasId: 'cv_1', sequence: 4, frames: [frame('d1', 'r1')] });
  assert.equal(framePins('chat-s'), unchanged);
  // A chat that moved to another canvas drops the old canvas's frames.
  syncFramePins('chat-s', { canvasId: 'cv_2', sequence: 1, frames: [frame('d1', 'r1')] });
  assert.equal(framePins('chat-s').length, 0);

  restoreFramePins('chat-s', before);
  restoreFramePins('chat-s', before);
  assert.deepEqual(
    framePins('chat-s').map((pin) => pin.designId),
    ['d1', 'd2'],
  );
  unpinFrames('chat-s');
  assert.equal(framePins('chat-s').length, 0);
});
