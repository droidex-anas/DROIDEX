import assert from 'node:assert/strict';
import test from 'node:test';
import { frameStep, readingOrder } from './boardKeys';

const at = (designId: string, x: number, y: number, height = 300) => ({
  designId,
  rect: { x, y, width: 400, height },
});

test('frames are read in rows from the top, each row left to right', () => {
  // c sits a little lower than b but in the same row; d starts the next row.
  const order = readingOrder([at('d', 0, 600), at('c', 900, 40), at('b', 450, 0), at('a', 0, 10)]);
  assert.deepEqual(order, ['a', 'b', 'c', 'd']);
  assert.deepEqual(readingOrder([]), []);
});

test('the arrows step through that order, Home and End jump to its ends', () => {
  const order = ['a', 'b', 'c'];
  const key = (name: string, modifiers: { altKey?: boolean; shiftKey?: boolean } = {}) => ({
    key: name,
    altKey: false,
    metaKey: false,
    ctrlKey: false,
    shiftKey: false,
    ...modifiers,
  });

  assert.equal(frameStep(key('ArrowRight'), order, 'a'), 'b');
  assert.equal(frameStep(key('ArrowDown'), order, 'b'), 'c');
  assert.equal(frameStep(key('ArrowLeft'), order, 'b'), 'a');
  assert.equal(frameStep(key('ArrowUp'), order, 'a'), 'a');
  assert.equal(frameStep(key('ArrowRight'), order, 'c'), 'c');
  assert.equal(frameStep(key('Home'), order, 'c'), 'a');
  assert.equal(frameStep(key('End'), order, 'a'), 'c');
  // A modified arrow moves the selection instead, and other keys are not steps.
  assert.equal(frameStep(key('ArrowRight', { altKey: true }), order, 'a'), null);
  assert.equal(frameStep(key('ArrowRight', { shiftKey: true }), order, 'a'), null);
  assert.equal(frameStep(key('Enter'), order, 'a'), null);
});
