import assert from 'node:assert/strict';
import test from 'node:test';
import type { PickedElement } from './pickedElement';
import {
  elementVariantPrompt,
  splitVariantName,
  variantFrames,
  variantPrompt,
  type VariantSource,
} from './variantRequests';
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

test('a label shortens a variant name before its suffix, and keeps the suffix whole', () => {
  assert.deepEqual(splitVariantName('Pro · Monthly plan (Variant 12)'), {
    base: 'Pro · Monthly plan',
    suffix: ' (Variant 12)',
  });
  // Only a trailing variant suffix is kept; any other name shortens at its end.
  for (const name of ['Pro · Monthly plan', 'Hey (Variant 9) old', 'Hey (Variant two)'])
    assert.deepEqual(splitVariantName(name), { base: name, suffix: '' });
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

test('a request for variants of picked elements names them and where every copy writes them', () => {
  const heading: PickedElement = {
    designId: 'd1',
    revisionId: 'r3',
    elementId: 'el_1',
    instancePath: '0/1',
    source: { file: 'main.tsx', start: 120, end: 160, line: 7 },
    tagName: 'h1',
    component: null,
    box: { x: 0, y: 0, width: 200, height: 40 },
    text: { excerpt: ' Ship\n faster ', box: { x: 0, y: 0, width: 120, height: 40 } },
  };
  assert.equal(
    elementVariantPrompt('Pricing', [heading], { kind: 'colour', count: 3, direction: '' }),
    'Make 3 colour variants of <h1> “Ship faster” in Pricing.\n' +
      'Each pinned frame starts as a copy of Pricing. In each, change only that element ' +
      '(main.tsx line 7 of Pricing’s source, the same lines in every copy) to a different ' +
      'colour palette, distinct from the others, and leave everything else and Pricing itself ' +
      'as they are.',
  );

  // Two picks of the same element, by the words they span, each keep their own words.
  const card = { ...heading, component: 'Card', text: null };
  const words = { ...heading, text: { excerpt: 'faster', box: heading.box } };
  const sidebar = { ...card, source: { ...card.source, file: 'Sidebar.tsx', line: 3 } };
  assert.equal(
    elementVariantPrompt('Pricing', [heading, words, sidebar], {
      kind: 'any',
      count: 2,
      direction: 'calmer',
    }),
    'Make 2 variants of <h1> “Ship faster” (main.tsx line 7), <h1> “faster” (main.tsx line 7), ' +
      'and Card (Sidebar.tsx line 3) in Pricing: calmer\n' +
      'Each pinned frame starts as a copy of Pricing. In each, change only those elements ' +
      '(at those lines of Pricing’s source, the same lines in every copy) to a different take on it within the current design system (layout, visual style or ' +
      'colour), distinct from the others, and leave everything else and Pricing itself as they are.',
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
