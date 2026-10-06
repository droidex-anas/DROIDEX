// What the board renders. There is no DOM test runner for `src/`, so the
// gestures themselves are covered by canvasGeometry.test.ts, which owns
// `reduceFrameDrag`; this suite reads the frame geometry a cancelled drag falls
// back to, and the board's own controls, off the real render.

import assert from 'node:assert/strict';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { CanvasBoard } from './CanvasBoard';
import type { CanvasFrame, CanvasSnapshot, FrameRect } from './protocol';

const ACKNOWLEDGED: FrameRect = { x: 100, y: 50, width: 400, height: 300 };

function frame(designId: string, rect: FrameRect): CanvasFrame {
  return {
    designId,
    name: `Design ${designId}`,
    rect,
    layoutVersion: 3,
    revisionId: 'rev_01',
    designSystem: { id: 'droidex', version: 1, mode: 'dark' },
    build: { status: 'pending', generation: 1 },
  };
}

function snapshotOf(...frames: CanvasFrame[]): CanvasSnapshot {
  return { canvasId: 'cv_01', sequence: 7, frames };
}

function render(snapshot: CanvasSnapshot): string {
  return renderToStaticMarkup(
    createElement(CanvasBoard, { snapshot, onArrangeFrames: () => Promise.resolve() }),
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
  assert.match(markup, /pointer-events:auto/);
});

test('the board opens at 100% with Fit live only when there is something to fit', () => {
  const empty = render(snapshotOf());
  const filled = render(snapshotOf(frame('dsg_hey', ACKNOWLEDGED)));

  assert.match(empty, /100%/);
  assert.match(empty, /<button type="button" disabled=""/);
  assert.match(filled, /Fit<\/button>/);
  assert.equal(filled.includes('disabled=""'), false);
});
