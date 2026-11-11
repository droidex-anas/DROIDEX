import assert from 'node:assert/strict';
import test from 'node:test';
import { activeRow, layerKey, moveRow } from './layerKeys';

const press = (key: string, modifiers: Partial<KeyboardEvent> = {}) => ({
  key,
  code: key.length === 1 ? `Key${key.toUpperCase()}` : key,
  shiftKey: false,
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

test('Right opens the row and Left closes it, unless a chord holds them', () => {
  assert.deepEqual(layerKey(press('ArrowRight'), 1, 3), { kind: 'open' });
  assert.deepEqual(layerKey(press('ArrowLeft'), 1, 3), { kind: 'close' });
  assert.equal(layerKey(press('ArrowRight', { metaKey: true }), 1, 3), null);
});

test('Ctrl+Shift+H hides or shows the row, Alt with Up or Down restacks it a row up to the ends, and with Left or Right moves it out or in', () => {
  // ⇧⌘H on the Mac; the test runs off it.
  assert.deepEqual(layerKey(press('H', { ctrlKey: true, shiftKey: true }), 1, 3), {
    kind: 'toggle-hidden',
  });
  assert.deepEqual(layerKey(press('ArrowUp', { altKey: true }), 1, 3), {
    kind: 'restack',
    index: 0,
  });
  assert.deepEqual(layerKey(press('ArrowDown', { altKey: true }), 1, 3), {
    kind: 'restack',
    index: 2,
  });
  // The front row goes no further forward, and the back row no further back, nor wraps.
  assert.equal(layerKey(press('ArrowUp', { altKey: true }), 0, 3), null);
  assert.equal(layerKey(press('ArrowDown', { altKey: true }), 2, 3), null);
  assert.deepEqual(layerKey(press('ArrowLeft', { altKey: true }), 1, 3), { kind: 'outdent' });
  assert.deepEqual(layerKey(press('ArrowRight', { altKey: true }), 1, 3), { kind: 'indent' });
  assert.deepEqual(moveRow(['a', 'b', 'c'], 0, 2), ['b', 'c', 'a']);
  assert.deepEqual(moveRow(['a', 'b', 'c'], 2, 0), ['c', 'a', 'b']);
});

test('Delete and Backspace remove the layer and Ctrl+D duplicates it, without other modifiers', () => {
  assert.deepEqual(layerKey(press('Delete'), 1, 3), { kind: 'remove' });
  assert.deepEqual(layerKey(press('Backspace'), 1, 3), { kind: 'remove' });
  // ⌘D on the Mac; the test runs off it.
  assert.deepEqual(layerKey(press('d', { ctrlKey: true }), 1, 3), { kind: 'duplicate' });
  assert.equal(layerKey(press('Backspace', { metaKey: true }), 1, 3), null);
  assert.equal(layerKey(press('d', { ctrlKey: true, shiftKey: true }), 1, 3), null);
});
test('the keyboard row is where it moved to, else the first selected frame, else the first row', () => {
  const designIds = ['a', 'b', 'c'];
  assert.equal(activeRow(designIds, 'b', ['c']), 1);
  // A frame that left the canvas no longer holds the row.
  assert.equal(activeRow(designIds, 'gone', ['c', 'a']), 2);
  assert.equal(activeRow(designIds, null, []), 0);
  assert.equal(activeRow([], null, []), -1);
});
