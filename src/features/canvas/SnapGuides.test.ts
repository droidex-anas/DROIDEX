import assert from 'node:assert/strict';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { SIZE_ROOM_PX } from './ElementOutlines';
import { SnapGuides, type GuideMarks } from './SnapGuides';

const viewport = { x: 0, y: 0, scale: 1 };

function pillsOf(marks: GuideMarks) {
  const markup = renderToStaticMarkup(createElement(SnapGuides, { marks, viewport }));
  return [...markup.matchAll(/<span class="canvas-snap-pill"([^>]*)>/g)].map(([, attributes]) => ({
    beside: attributes.includes('data-beside'),
    top: Number(/top:(-?[\d.]+)px/.exec(attributes)?.[1]),
  }));
}

test('a distance down from a sized box sits below its size chip, and a short one beside its line', () => {
  const [below, short] = pillsOf({
    guides: [],
    gaps: [
      { axis: 'y', from: 100, to: 140, at: 50 },
      { axis: 'x', from: 0, to: 5, at: 20 },
    ],
    sizedBottom: 100,
  });
  assert.ok(below.top > 100 + SIZE_ROOM_PX);
  assert.equal(below.beside, false);
  assert.equal(short.beside, true);
});
