import assert from 'node:assert/strict';
import test from 'node:test';
import { displayFor, layoutOf } from './elementPanelChoices';

test('a layout segment reads and keeps whether its element sits inline', () => {
  assert.equal(layoutOf('flex'), 'flex');
  assert.equal(layoutOf('inline-flex'), 'flex');
  assert.equal(layoutOf('inline-block'), 'block');
  assert.equal(layoutOf('inline'), null);
  assert.equal(layoutOf('none'), null);

  assert.equal(displayFor('block', 'grid'), 'grid');
  assert.equal(displayFor('inline', 'flex'), 'inline-flex');
  assert.equal(displayFor('inline-grid', 'block'), 'inline-block');
  assert.equal(displayFor('none', 'flex'), 'flex');
});
