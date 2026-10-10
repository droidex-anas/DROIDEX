// What the board renders. There is no DOM test runner for `src/`, so the
// gestures themselves are covered by canvasGeometry.test.ts, which owns
// `reduceFrameDrag`, and by the Playwright board smoke, which owns live pointer
// capture, arrange acknowledgements and gesture timers. This suite reads the
// frame geometry a cancelled drag falls back to, the Select overlay Interact
// removes, and the board's own controls, off the real render.

import assert from 'node:assert/strict';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { CanvasBoard } from './CanvasBoard';
import { DesignPreview } from './DesignPreview';
import { SELECT_MODE, type BoardInteraction } from './canvasState';
import type { CanvasFrame, CanvasSnapshot, FrameRect } from './protocol';

const ACKNOWLEDGED: FrameRect = { x: 100, y: 50, width: 400, height: 300 };

function frame(designId: string, rect: FrameRect): CanvasFrame {
  return {
    designId,
    name: `Design ${designId}`,
    rect,
    layoutVersion: 3,
    manifestVersion: 1,
    revisionId: 'rev_01',
    designSystem: { id: 'droidex', version: 1, mode: 'dark' },
    build: { status: 'pending', generation: 1 },
  };
}

function withBuild(base: CanvasFrame, build: CanvasFrame['build']): CanvasFrame {
  return { ...base, build };
}

function snapshotOf(...frames: CanvasFrame[]): CanvasSnapshot {
  return { canvasId: 'cv_01', sequence: 7, frames };
}

function render(
  snapshot: CanvasSnapshot,
  interaction: BoardInteraction = SELECT_MODE,
  agentWorking = false,
): string {
  return renderToStaticMarkup(
    createElement(CanvasBoard, {
      snapshot,
      interaction,
      agentWorking,
      onInteractionChange: () => undefined,
      onArrangeFrames: () => Promise.resolve(),
      renderPreview: (frame, revisionId) =>
        createElement(DesignPreview, {
          canvasId: snapshot.canvasId,
          frame,
          revisionId,
          readArtifact: () => Promise.resolve(null),
          reportPreview: () => undefined,
        }),
    }),
  );
}

test('with no drag of its own the board draws each frame at its acknowledged rect', () => {
  // This is what a cancel restores to: the board holds no rect, so the
  // snapshot's is the only one it can draw.
  const markup = render(snapshotOf(frame('dsg_hey', ACKNOWLEDGED)));

  assert.match(markup, /left:100px/);
  assert.match(markup, /top:50px/);
  assert.match(markup, /width:400px/);
  assert.match(markup, /height:300px/);
  // Spec §4: Select's transparent input overlay is installed by default.
  assert.match(markup, /data-canvas-input-overlay/);
});

test('every frame is a tab stop that reports whether it is selected', () => {
  const markup = render(snapshotOf(frame('a', ACKNOWLEDGED), frame('b', ACKNOWLEDGED)), {
    mode: 'select',
    selectedFrameIds: ['b'],
    interactedFrameId: null,
  });

  const headers = markup.match(/data-frame-header[^>]*/g) ?? [];
  assert.equal(headers.length, 2);
  assert.equal(headers.filter((header) => header.includes('aria-pressed="true"')).length, 1);
  assert.ok(headers.every((header) => header.includes('tabindex="0"')));
});

test('Select installs the transparent input overlay and Interact removes it', () => {
  // Spec §4: the overlay is what gives the board pointer ownership over a
  // guest, so Interact cannot leave it in place.
  const selecting = render(snapshotOf(frame('dsg_hey', ACKNOWLEDGED)));
  const interacting = render(snapshotOf(frame('dsg_hey', ACKNOWLEDGED)), {
    mode: 'interact',
    selectedFrameIds: ['dsg_hey'],
    interactedFrameId: 'dsg_hey',
  });

  assert.match(selecting, /data-canvas-input-overlay/);
  assert.equal(interacting.includes('data-canvas-input-overlay'), false);
  assert.match(interacting, /data-board-mode="interact"/);
});

test('the board opens at 100% with Fit live only when there is something to fit', () => {
  const empty = render(snapshotOf());
  const filled = render(snapshotOf(frame('dsg_hey', ACKNOWLEDGED)));

  assert.match(empty, /100%/);
  assert.match(empty, /aria-label="Fit"[^>]*disabled=""/);
  assert.match(filled, /aria-label="Fit"/);
  assert.equal(filled.includes('disabled=""'), false);
});

test('align and distribute appear only when a selection gives them work', () => {
  const alone = render(snapshotOf(frame('a', ACKNOWLEDGED), frame('b', ACKNOWLEDGED)), {
    mode: 'select',
    selectedFrameIds: ['a'],
    interactedFrameId: null,
  });
  const pair = render(snapshotOf(frame('a', ACKNOWLEDGED), frame('b', ACKNOWLEDGED)), {
    mode: 'select',
    selectedFrameIds: ['a', 'b'],
    interactedFrameId: null,
  });

  assert.equal(alone.includes('Align left edges'), false);
  assert.match(pair, /Align left edges/);
  // Two frames have no space between them to spread, so distribute is offered
  // but not usable yet.
  assert.match(pair, /aria-label="Space evenly across" disabled=""/);
});

test('a frame with no live preview says only what is true of it', () => {
  const base = frame('dsg_hey', ACKNOWLEDGED);
  const reserved = { ...base, revisionId: null };
  const empty = render(snapshotOf(reserved));
  const writing = render(snapshotOf(reserved), SELECT_MODE, true);
  const building = render(snapshotOf(withBuild(base, { status: 'building', generation: 2 })));
  const cancelled = render(snapshotOf(withBuild(base, { status: 'cancelled', generation: 2 })));
  const failed = render(
    snapshotOf(
      withBuild(base, {
        status: 'failed',
        generation: 2,
        lastWorkingRevisionId: null,
        diagnostics: [
          { code: 'syntax_error', message: 'Unexpected token', file: 'main.tsx', line: 3 },
        ],
      }),
    ),
  );

  // A reserved frame shimmers as written only while its chat's agent works.
  assert.match(empty, /Empty frame/);
  assert.equal(empty.includes('canvas-bloom-label'), false);
  assert.match(writing, /Writing/);
  assert.match(writing, /canvas-bloom-label/);
  assert.match(building, /canvas-bloom-label/);
  assert.match(building, /Building/);
  assert.match(cancelled, /Build cancelled/);
  assert.equal(cancelled.includes('canvas-bloom-label'), false);
  // A failure with nothing older to show says where and why, and mounts no guest.
  assert.match(failed, /Didn’t build/);
  assert.match(failed, /main\.tsx · line 3/);
  assert.match(failed, /Unexpected token/);
  assert.equal(failed.includes('data-preview-phase'), false);
});
