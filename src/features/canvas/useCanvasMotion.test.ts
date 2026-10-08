import assert from 'node:assert/strict';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { canvasMotion } from './canvasMotion';
import { useCanvasMotion } from './useCanvasMotion';

// framer-motion answers `null` until it has read the media query, which is what
// a server render sees. Full motion is the only honest reading of "not known
// yet": a comparison flipped to `!== false` here would flatten the whole feature
// for everybody, which is why this is worth pinning.
test('an unread reduced-motion preference leaves full motion', () => {
  let resolved: unknown = null;

  function Probe() {
    resolved = useCanvasMotion();
    return null;
  }

  renderToStaticMarkup(createElement(Probe));
  assert.equal(resolved, canvasMotion);
});
