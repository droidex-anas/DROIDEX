import assert from 'node:assert/strict';
import test from 'node:test';
import { navigationIndex, typeaheadIndex } from './menuKeys';

test('arrows wrap around the menu and enter it from either end', () => {
  assert.equal(navigationIndex('ArrowDown', -1, 3), 0);
  assert.equal(navigationIndex('ArrowUp', -1, 3), 2);
  assert.equal(navigationIndex('ArrowDown', 2, 3), 0);
  assert.equal(navigationIndex('ArrowUp', 0, 3), 2);
  assert.equal(navigationIndex('Home', 1, 3), 0);
  assert.equal(navigationIndex('End', 1, 3), 2);
  assert.equal(navigationIndex('ArrowRight', 1, 3), null);
  assert.equal(navigationIndex('ArrowDown', -1, 0), null);
});

test('type-ahead cycles on a repeated letter and refines on a longer query', () => {
  const labels = ['Rename', 'Pin', 'Reveal in Finder', 'Archive'];
  assert.equal(typeaheadIndex(labels, 'r', -1), 0);
  assert.equal(typeaheadIndex(labels, 'r', 0), 2);
  assert.equal(typeaheadIndex(labels, 'rr', 2), 0);
  assert.equal(typeaheadIndex(labels, 'rev', 0), 2);
  assert.equal(typeaheadIndex(labels, 'ren', 0), 0);
  assert.equal(typeaheadIndex(labels, 'x', 1), -1);
});
