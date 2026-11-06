import assert from 'node:assert/strict';
import test from 'node:test';
import { variantFrames, variantPrompt, type VariantSource } from './variantRequests';
import { MAX_FRAME_NAME_LENGTH } from './wireValidation';

const source: VariantSource = {
  canvasId: 'cv_1',
  revision: { designId: 'd1', revisionId: 'r3' },
  name: 'Hey',
  width: 720,
  height: 520,
  designSystem: { id: 'droidex', version: 2, mode: 'dark' },
};

test('variants are copies of the pinned revision, placed beside the source as its set', () => {
  const input = variantFrames(source, 2, 'm1', ['Hey']);

  assert.deepEqual(input.placeBeside, { designId: 'd1' });
  assert.equal(input.mutationId, 'm1');
  assert.deepEqual(
    input.frames.map((frame) => frame.name),
    ['Hey (Variant 1)', 'Hey (Variant 2)'],
  );
  for (const frame of input.frames) {
    assert.deepEqual(frame.seed, {
      kind: 'revision',
      canvasId: 'cv_1',
      revision: { designId: 'd1', revisionId: 'r3' },
    });
    assert.equal(frame.variantOf, 'd1');
    assert.equal(frame.width, 720);
    assert.equal(frame.height, 520);
    assert.deepEqual(frame.designSystem, source.designSystem);
  }
});

test('a second set is numbered after the variants of that name already on the board', () => {
  const board = [
    'Hey',
    'Hey (Variant 1)',
    'Hey (Variant 3)',
    'Hello (Variant 7)',
    'Hey (Variant 9) old',
  ];

  assert.deepEqual(
    variantFrames(source, 2, 'm2', board).frames.map((frame) => frame.name),
    ['Hey (Variant 4)', 'Hey (Variant 5)'],
  );
});

test('a long source name is shortened so the variant name stays within the limit', () => {
  const long = { ...source, name: 'x'.repeat(MAX_FRAME_NAME_LENGTH) };
  const [first] = variantFrames(long, 2, 'm3', []).frames;

  assert.equal(first.name.length, MAX_FRAME_NAME_LENGTH);
  assert.ok(first.name.endsWith(' (Variant 1)'));
  const [next] = variantFrames(long, 2, 'm4', [first.name]).frames;
  assert.ok(next.name.endsWith(' (Variant 2)'));
});

test('the request says what to change in the user words, and that the source stays', () => {
  assert.equal(
    variantPrompt('Hey', { kind: 'style', count: 3, direction: '  softer corners, NOT our kit ' }),
    'Make 3 style variants of Hey: softer corners, NOT our kit\n' +
      'Each pinned frame starts as a copy of Hey; give each a different visual style, ' +
      'distinct from the others, and leave Hey as it is.',
  );
  assert.equal(
    variantPrompt('Hey', { kind: 'any', count: 2, direction: '' }),
    'Make 2 variants of Hey.\n' +
      'Each pinned frame starts as a copy of Hey; give each a different take on it within the ' +
      'current design system (layout, visual style or colour), distinct from the others, ' +
      'and leave Hey as it is.',
  );
});

test('an exploratory request frees the variants from the kit and the project look, not from tokens', () => {
  assert.equal(
    variantPrompt('Hey', { kind: 'explore', count: 4, direction: '' }),
    'Make 4 exploratory variants of Hey.\n' +
      'Each pinned frame starts as a copy of Hey; give each a clearly different visual direction, ' +
      'distinct from the others, and leave Hey as it is.\n' +
      'Explore freely: the variants need not follow the current design system or the project’s ' +
      'look, but keep their code clean and their colours, type and spacing in tokens.',
  );
});
