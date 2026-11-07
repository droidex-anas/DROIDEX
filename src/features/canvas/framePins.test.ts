import assert from 'node:assert/strict';
import test from 'node:test';
import { dismissToast, subscribeToasts, type ToastItem } from '../../lib/toast';
import {
  canvasContextOf,
  framePins,
  promptWithFramePins,
  restoreFramePins,
  syncFramePins,
  toggleFramePins,
  unpinFrames,
  untagsFrames,
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
    variantOf: null,
    seededRevisionId: null,
    build: { status: 'pending', generation: 1 },
  };
}

test('a frame is tagged once, by the chat that tagged it, and a second press untags it', () => {
  toggleFramePins('chat-a', 'cv_1', [frame('d1', 'r1', 'Pricing · 3 Tiers')]);
  // A selection that is partly tagged tags the rest and leaves the tagged in place.
  toggleFramePins('chat-a', 'cv_1', [frame('d2', 'r1'), frame('d1', 'r1')]);

  assert.deepEqual(
    framePins('chat-a').map(({ designId, size, name }) => ({ designId, size, name })),
    [
      { designId: 'd1', size: '720 × 520', name: 'Pricing · 3 Tiers' },
      { designId: 'd2', size: '720 × 520', name: 'Design d2' },
    ],
  );
  assert.equal(framePins('chat-b').length, 0);

  toggleFramePins('chat-a', 'cv_1', [frame('d1', 'r1')]);
  assert.deepEqual(
    framePins('chat-a').map((pin) => pin.designId),
    ['d2'],
  );
  // A selection that is all tagged untags together.
  toggleFramePins('chat-a', 'cv_1', [frame('d1', 'r1'), frame('d2', 'r1')]);
  toggleFramePins('chat-a', 'cv_1', [frame('d1', 'r1'), frame('d2', 'r1')]);
  assert.equal(framePins('chat-a').length, 0);
  // One request pins one canvas, so a frame from another starts over.
  toggleFramePins('chat-a', 'cv_1', [frame('d1', 'r1')]);
  toggleFramePins('chat-a', 'cv_2', [frame('d9', 'r1')]);
  assert.deepEqual(
    framePins('chat-a').map((pin) => pin.designId),
    ['d9'],
  );
});

test('a selection past what a prompt carries says so, and the next press untags it', () => {
  let shown: ToastItem[] = [];
  const stopWatching = subscribeToasts((toasts) => {
    shown = toasts;
  });
  const frames = Array.from({ length: 40 }, (_, index) => frame(`d${String(index)}`, 'r1'));

  toggleFramePins('chat-f', 'cv_1', frames);
  assert.equal(framePins('chat-f').length, 32);
  assert.deepEqual(
    shown.map((item) => item.message),
    ['A prompt carries at most 32 frames, so 8 weren’t tagged.'],
  );
  for (const item of shown) dismissToast(item.id);
  stopWatching();

  assert.equal(untagsFrames(framePins('chat-f'), 'cv_1', frames), true);
  toggleFramePins('chat-f', 'cv_1', frames);
  assert.equal(framePins('chat-f').length, 0);
});

test('a queued request keeps the revisions it was sent with when the pins move on', () => {
  toggleFramePins('chat-q', 'cv_1', [frame('d1', 'r1')]);
  const queued = framePins('chat-q');

  // The agent revises the frame and the user pins another before the queue drains.
  syncFramePins('chat-q', {
    canvasId: 'cv_1',
    sequence: 2,
    frames: [frame('d1', 'r2'), frame('d2', 'r1')],
  });
  toggleFramePins('chat-q', 'cv_1', [frame('d2', 'r1')]);

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

test('pins follow the attached canvas, and come off by frame however they have moved', () => {
  toggleFramePins('chat-s', 'cv_1', [frame('d1', 'r1')]);
  toggleFramePins('chat-s', 'cv_1', [frame('d2', 'r1')]);

  // d2 was deleted from the board; d1 is as it was.
  syncFramePins('chat-s', { canvasId: 'cv_1', sequence: 3, frames: [frame('d1', 'r1')] });
  assert.deepEqual(
    framePins('chat-s').map((pin) => pin.designId),
    ['d1'],
  );
  const sending = framePins('chat-s');
  syncFramePins('chat-s', { canvasId: 'cv_1', sequence: 4, frames: [frame('d1', 'r1')] });
  assert.equal(framePins('chat-s'), sending);
  // The agent revises d1 while the prompt that carries it is still being sent:
  // taking that prompt's pins off afterwards still takes d1 off.
  syncFramePins('chat-s', { canvasId: 'cv_1', sequence: 5, frames: [frame('d1', 'r2')] });
  unpinFrames('chat-s', sending);
  assert.equal(framePins('chat-s').length, 0);

  toggleFramePins('chat-s', 'cv_1', [frame('d1', 'r2')]);
  // A chat that moved to another canvas drops the old canvas's frames.
  syncFramePins('chat-s', { canvasId: 'cv_2', sequence: 1, frames: [frame('d1', 'r1')] });
  assert.equal(framePins('chat-s').length, 0);
});

test('an edited queued prompt brings back only frames still on the attached board', () => {
  toggleFramePins('chat-e', 'cv_1', [frame('d1', 'r1')]);
  toggleFramePins('chat-e', 'cv_1', [frame('d2', 'r1')]);
  const queued = framePins('chat-e');
  unpinFrames('chat-e');

  // Before the pane has shown the board, the prompt's own canvas is kept whole.
  restoreFramePins('chat-e', queued);
  restoreFramePins('chat-e', queued);
  assert.deepEqual(
    framePins('chat-e').map((pin) => pin.designId),
    ['d1', 'd2'],
  );
  unpinFrames('chat-e');

  // Once it has, a deleted frame stays off, a revised one comes back as it is now,
  // and frames of a canvas the chat has left do not come back at all.
  syncFramePins('chat-e', { canvasId: 'cv_1', sequence: 2, frames: [frame('d1', 'r3')] });
  restoreFramePins('chat-e', queued);
  assert.deepEqual(
    framePins('chat-e').map(({ designId, revisionId }) => ({ designId, revisionId })),
    [{ designId: 'd1', revisionId: 'r3' }],
  );
  unpinFrames('chat-e');
  const closePane = syncFramePins('chat-e', {
    canvasId: 'cv_2',
    sequence: 1,
    frames: [frame('d1', 'r1')],
  });
  restoreFramePins('chat-e', queued);
  assert.equal(framePins('chat-e').length, 0);

  // A pane that closed keeps no board: the prompt's own canvas decides again.
  closePane();
  restoreFramePins('chat-e', queued);
  assert.deepEqual(
    framePins('chat-e').map((pin) => pin.designId),
    ['d1', 'd2'],
  );
});
