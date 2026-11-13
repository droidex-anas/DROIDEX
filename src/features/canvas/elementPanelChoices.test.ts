import assert from 'node:assert/strict';
import test from 'node:test';
import { displayFor, layoutOf } from './elementPanelChoices';

test('only block, flex and grid read as a layout segment, flex and grid inline or not', () => {
  assert.equal(layoutOf('block'), 'block');
  assert.equal(layoutOf('flex'), 'flex');
  assert.equal(layoutOf('inline-flex'), 'flex');
  assert.equal(layoutOf('grid'), 'grid');
  assert.equal(layoutOf('inline-grid'), 'grid');
  // The ⋯ menu's displays, and any other, read as no segment.
  assert.equal(layoutOf('inline-block'), null);
  assert.equal(layoutOf('inline'), null);
  assert.equal(layoutOf('none'), null);
  assert.equal(layoutOf('contents'), null);
});

test('Block writes block, and flex or grid keep an inline element inline', () => {
  assert.equal(displayFor('inline', 'block'), 'block');
  assert.equal(displayFor('inline-block', 'block'), 'block');
  assert.equal(displayFor('inline-grid', 'block'), 'block');
  assert.equal(displayFor('none', 'block'), 'block');
  assert.equal(displayFor('block', 'grid'), 'grid');
  assert.equal(displayFor('none', 'flex'), 'flex');
  assert.equal(displayFor('inline', 'flex'), 'inline-flex');
  assert.equal(displayFor('inline-block', 'grid'), 'inline-grid');
  assert.equal(displayFor('inline-flex', 'grid'), 'inline-grid');
});
