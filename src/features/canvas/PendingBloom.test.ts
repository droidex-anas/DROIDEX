import assert from 'node:assert/strict';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { PendingBloom } from './PendingBloom';
import { motionFor, type CanvasActivityStage } from './canvasMotion';

function render(stage: CanvasActivityStage, visible: boolean, reducedMotion: boolean): string {
  return renderToStaticMarkup(
    createElement(PendingBloom, { stage, visible, motion: motionFor(reducedMotion) }),
  );
}

test('a busy visible frame shimmers its stage on the spec loop', () => {
  const markup = render('building', true, false);
  assert.match(markup, /canvas-bloom-label/);
  assert.match(markup, /animation-duration:1600ms/);
  assert.match(markup, /animation-play-state:running/);
  assert.match(markup, /Building/);
});

test('an offscreen frame pauses the shimmer instead of looping', () => {
  const markup = render('building', false, false);
  assert.match(markup, /animation-play-state:paused/);
  assert.doesNotMatch(markup, /animation-play-state:running/);
});

test('reduced motion leaves a static stage label', () => {
  const markup = render('building', true, true);
  assert.doesNotMatch(markup, /canvas-bloom-label/);
  assert.doesNotMatch(markup, /animation/);
  assert.match(markup, /Building/);
});

test('a settled stage does not shimmer', () => {
  const markup = render('ready', true, false);
  assert.doesNotMatch(markup, /canvas-bloom-label/);
  assert.match(markup, /Ready/);
});
