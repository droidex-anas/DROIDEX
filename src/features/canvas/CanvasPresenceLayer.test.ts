import assert from 'node:assert/strict';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { canvasMotion } from './canvasMotion';
import type { CanvasPresence } from './canvasPresence';
import { CanvasPresenceLayer } from './CanvasPresenceLayer';
import { PreviewRuns } from './previewRuns';

const DRAWN = ['a', 'b', 'c'].map((designId, index) => ({
  designId,
  rect: { x: index * 1000, y: 0, width: 800, height: 600 },
}));

/** The frames the layer draws a cursor over. */
function cursorFrames(presence: CanvasPresence, visible: string[]): string[] {
  const markup = renderToStaticMarkup(
    createElement(CanvasPresenceLayer, {
      presence,
      frames: [],
      drawn: DRAWN,
      visible,
      motion: canvasMotion,
      runs: new PreviewRuns(),
      readSource: () => Promise.reject(new Error('No tour reads a source here.')),
    }),
  );
  return [...markup.matchAll(/class="canvas-presence" style="left:(\d+)/g)].map(
    (match) => DRAWN[Number(match[1]) / 1000].designId,
  );
}

test("an agent's cursor goes to the frame on screen its running call names", () => {
  const kairo = { key: 'chat', name: 'Kairo', color: 'crimson' } as const;
  const lyra = { key: 'chat/w1', name: 'Lyra', color: 'teal' } as const;
  // Kairo made `a`, which waits on it, empty, while it writes `b`.
  const presence: CanvasPresence = new Map([
    ['a', { agent: kairo, named: false }],
    ['b', { agent: kairo, named: true }],
    ['c', { agent: lyra, named: true }],
  ]);

  assert.deepEqual(cursorFrames(presence, ['a', 'b', 'c']), ['b', 'c']);
  // With that frame off screen, the cursor goes to the agent's first frame on screen.
  assert.deepEqual(cursorFrames(presence, ['a', 'c']), ['a', 'c']);
});
