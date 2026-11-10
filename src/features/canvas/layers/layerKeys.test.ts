import assert from 'node:assert/strict';
import test from 'node:test';
import { activeRow, layerKey } from './layerKeys';

const press = (key: string, modifiers: Partial<KeyboardEvent> = {}) => ({
  key,
  metaKey: false,
  ctrlKey: false,
  altKey: false,
  ...modifiers,
});

test('the arrows, Home and End walk the rows in order, and the other keys act on the row', () => {
  assert.deepEqual(layerKey(press('ArrowDown'), 0, 3), { kind: 'move', index: 1 });
  assert.deepEqual(layerKey(press('ArrowUp'), 0, 3), { kind: 'move', index: 2 });
  assert.deepEqual(layerKey(press('End'), 0, 3), { kind: 'move', index: 2 });
  assert.deepEqual(layerKey(press('Home'), 2, 3), { kind: 'move', index: 0 });
  assert.deepEqual(layerKey(press(' '), 1, 3), { kind: 'pick' });
  assert.deepEqual(layerKey(press('Enter'), 1, 3), { kind: 'focus' });
  assert.deepEqual(layerKey(press('F2'), 1, 3), { kind: 'rename' });
  assert.deepEqual(layerKey(press('Escape'), 1, 3), { kind: 'leave' });
  // A command chord belongs to the app, such as ⌥1 closing the panel.
  assert.equal(layerKey(press('ArrowDown', { metaKey: true }), 0, 3), null);
  assert.equal(layerKey(press('1', { altKey: true }), 0, 3), null);
});

test('the keyboard row is where it moved to, else the first selected frame, else the first row', () => {
  const designIds = ['a', 'b', 'c'];
  assert.equal(activeRow(designIds, 'b', ['c']), 1);
  // A frame that left the canvas no longer holds the row.
  assert.equal(activeRow(designIds, 'gone', ['c', 'a']), 2);
  assert.equal(activeRow(designIds, null, []), 0);
  assert.equal(activeRow([], null, []), -1);
});
