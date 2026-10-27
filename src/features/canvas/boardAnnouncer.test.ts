import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildAnnouncement,
  removalAnnouncement,
  selectionAnnouncement,
  zoomAnnouncement,
} from './boardAnnouncer';
import { NO_SHOWN_REVISIONS } from './previewLabels';
import type { CanvasBuildState, CanvasFrame } from './protocol';

const READY: CanvasBuildState = {
  status: 'ready',
  generation: 2,
  revisionId: 'r1',
  artifactId: 'a'.repeat(64),
  elements: [],
  diagnostics: [],
};

function frame(designId: string, build: CanvasBuildState, name = `Design ${designId}`) {
  return {
    designId,
    name,
    rect: { x: 0, y: 0, width: 400, height: 300 },
    layoutVersion: 1,
    manifestVersion: 1,
    revisionId: 'r1',
    designSystem: { id: 'droidex', version: 1, mode: 'dark' },
    build,
  } satisfies CanvasFrame;
}

test('a build is said once, when its status moves, and a move or rename says nothing', () => {
  const building = frame('a', { status: 'building', generation: 2 }, 'Pricing');
  const queued = frame('a', { status: 'pending', generation: 2 }, 'Pricing');
  const say = (previous: CanvasFrame[], next: CanvasFrame[]) =>
    buildAnnouncement(previous, next, NO_SHOWN_REVISIONS);

  assert.equal(say([queued], [building]), 'Pricing is building');
  assert.equal(say([building], [frame('a', READY, 'Pricing')]), 'Pricing is ready');
  assert.equal(
    say(
      [building],
      [frame('a', { ...READY, status: 'failed', lastWorkingRevisionId: null }, 'Pricing')],
    ),
    'Pricing didn’t build',
  );
  assert.equal(say([building], [building]), null);
  assert.equal(
    say([building], [{ ...building, name: 'Renamed', rect: { ...building.rect } }]),
    null,
  );
  // A frame going back to the queue is not news.
  assert.equal(say([frame('a', READY)], [queued]), null);

  // A streaming checkpoint over a design already on show builds quietly and
  // is said only once it lands.
  const showing = new Map([['a', 'r1']]);
  assert.equal(buildAnnouncement([frame('a', READY, 'Pricing')], [building], showing), null);
  assert.equal(
    buildAnnouncement([building], [frame('a', READY, 'Pricing')], showing),
    'Pricing is ready',
  );
});

test('many frames changing at once are counted rather than read out', () => {
  const before = ['a', 'b', 'c'].map((id) => frame(id, { status: 'building', generation: 1 }));
  const after = [
    frame('a', READY),
    frame('b', READY),
    frame('c', { ...READY, status: 'failed', lastWorkingRevisionId: null }),
  ];
  assert.equal(
    buildAnnouncement(before, after, NO_SHOWN_REVISIONS),
    '3 frames changed: 2 ready, 1 didn’t build',
  );
  assert.equal(
    buildAnnouncement(before.slice(0, 2), after.slice(0, 2), NO_SHOWN_REVISIONS),
    'Design a is ready; Design b is ready',
  );
});

test('deleted frames are named, and counted beyond two', () => {
  const frames = ['a', 'b', 'c'].map((id) => frame(id, READY));
  assert.equal(removalAnnouncement(frames, frames.slice(1)), 'Design a deleted');
  assert.equal(removalAnnouncement(frames, []), '3 frames deleted');
  assert.equal(removalAnnouncement(frames, frames), null);
});

test('a selection is said unless the focused label already says it', () => {
  const name = (id: string) => `Design ${id}`;
  assert.equal(selectionAnnouncement([], ['a'], name, null), 'Design a selected');
  assert.equal(selectionAnnouncement([], ['a'], name, 'a'), null);
  assert.equal(selectionAnnouncement(['a'], ['a', 'b'], name, 'a'), '2 frames selected');
  assert.equal(selectionAnnouncement(['a', 'b'], [], name, null), 'Selection cleared');
  assert.equal(selectionAnnouncement(['a'], ['a'], name, null), null);
  assert.equal(selectionAnnouncement([], [], name, null), null);
  assert.equal(zoomAnnouncement(0.333), 'Zoom 33%');
});
