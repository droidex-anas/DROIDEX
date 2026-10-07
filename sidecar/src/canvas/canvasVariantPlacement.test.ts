import assert from 'node:assert/strict';
import test from 'node:test';
import { placeVariants } from './canvasVariantPlacement.js';

const source = { x: 100, y: -40, width: 720, height: 720 };
const size = { width: 720, height: 720 };

test('one to four variants occupy deterministic rows below an untouched source', () => {
  const existing = [source, { x: -800, y: 0, width: 720, height: 720 }];
  const before = structuredClone(existing);
  const four = [
    { x: 100, y: 760, ...size },
    { x: 900, y: 760, ...size },
    { x: 100, y: 1560, ...size },
    { x: 900, y: 1560, ...size },
  ];
  for (const count of [1, 2, 3, 4]) {
    assert.deepEqual(placeVariants(source, existing, count, size), four.slice(0, count));
    assert.deepEqual(
      placeVariants(source, [...existing].reverse(), count, size),
      four.slice(0, count),
    );
  }
  assert.deepEqual(existing, before);
});

test('occupied preferred slots skip to the next free row, including the spacing gap', () => {
  const existing = [
    source,
    { x: 900, y: 760, ...size },
    // This frame does not overlap a slot but is within its 80 px resting gap.
    { x: -630, y: 1560, ...size },
  ];
  const before = structuredClone(existing);
  assert.deepEqual(placeVariants(source, existing, 4, size), [
    { x: 100, y: 2360, ...size },
    { x: 900, y: 2360, ...size },
    { x: 100, y: 3160, ...size },
    { x: 900, y: 3160, ...size },
  ]);
  assert.deepEqual(existing, before);
});
