import assert from 'node:assert/strict';
import test from 'node:test';
import { annotationShortcut, focusStep, readingOrder } from './boardKeys';

const at = (designId: string, x: number, y: number, height = 300) => ({
  designId,
  rect: { x, y, width: 400, height },
});

test('frames are read in rows from the top, each row left to right', () => {
  // c sits a little lower than b but in the same row; d starts the next row.
  const order = readingOrder([at('d', 0, 600), at('c', 900, 40), at('b', 450, 0), at('a', 0, 10)]);
  assert.deepEqual(
    order.map(({ designId }) => designId),
    ['a', 'b', 'c', 'd'],
  );
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

  assert.equal(focusStep(key('ArrowRight'), order, 'a'), 'b');
  assert.equal(focusStep(key('ArrowDown'), order, 'b'), 'c');
  assert.equal(focusStep(key('ArrowLeft'), order, 'b'), 'a');
  assert.equal(focusStep(key('ArrowUp'), order, 'a'), 'a');
  assert.equal(focusStep(key('ArrowRight'), order, 'c'), 'c');
  assert.equal(focusStep(key('Home'), order, 'c'), 'a');
  assert.equal(focusStep(key('End'), order, 'a'), 'c');
  // A modified arrow moves the selection instead, and other keys are not steps.
  assert.equal(focusStep(key('ArrowRight', { altKey: true }), order, 'a'), null);
  assert.equal(focusStep(key('ArrowRight', { shiftKey: true }), order, 'a'), null);
  assert.equal(focusStep(key('Enter'), order, 'a'), null);
});

test('each annotation tool has a letter, and a modified letter is not one', () => {
  const key = (name: string, shiftKey = false) =>
    ({ key: name, altKey: false, metaKey: false, ctrlKey: false, shiftKey }) as Parameters<
      typeof annotationShortcut
    >[0];
  assert.deepEqual(
    ['p', 'R', 'o', 'l', 'a', 't', 'n'].map((letter) => annotationShortcut(key(letter))),
    ['draw', 'rect', 'ellipse', 'line', 'arrow', 'text', 'note'],
  );
  assert.equal(annotationShortcut(key('v')), null);
  assert.equal(annotationShortcut(key('a', true)), null);
});
