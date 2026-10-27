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

test('variants are seeded from the pinned revision and placed beside the source', () => {
  const input = variantFrames(source, { kind: 'layout', count: 2, direction: '' }, 'm1');

  assert.deepEqual(input.placeBeside, { designId: 'd1' });
  assert.equal(input.mutationId, 'm1');
  assert.deepEqual(
    input.frames.map((frame) => frame.name),
    ['Hey · layout 1', 'Hey · layout 2'],
  );
  for (const frame of input.frames) {
    assert.deepEqual(frame.seed, {
      kind: 'revision',
      canvasId: 'cv_1',
      revision: { designId: 'd1', revisionId: 'r3' },
    });
    assert.equal(frame.width, 720);
    assert.equal(frame.height, 520);
    assert.deepEqual(frame.designSystem, source.designSystem);
  }
});

test('a long source name is shortened so the variant name stays within the limit', () => {
  const long = { ...source, name: 'x'.repeat(MAX_FRAME_NAME_LENGTH) };
  const [frame] = variantFrames(long, { kind: 'colour', count: 1, direction: '' }, 'm2').frames;

  assert.equal(frame.name.length, MAX_FRAME_NAME_LENGTH);
  assert.ok(frame.name.endsWith(' · colour 1'));
});

test('the request says what to change in the user words, and that the source stays', () => {
  assert.equal(
    variantPrompt('Hey', { kind: 'style', count: 3, direction: '  softer\ncorners ' }),
    'Make 3 style variants of Hey: softer corners\n' +
      'Each pinned frame starts as a copy of Hey; give each a different visual style and leave Hey as it is.',
  );
  assert.equal(
    variantPrompt('Hey', { kind: 'colour', count: 1, direction: '' }),
    'Make a colour variant of Hey.\n' +
      'The pinned frame starts as a copy of Hey; give it a different colour palette and leave Hey as it is.',
  );
});
