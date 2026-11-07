import assert from 'node:assert/strict';
import test from 'node:test';
import { placeVariants } from './canvasVariantPlacement.js';

const source = { x: 100, y: -40, width: 720, height: 720 };
const size = { width: 720, height: 720 };

test('variants sit in one evenly spaced row below an untouched source, from its left edge', () => {
  const existing = [source, { x: -800, y: 0, width: 720, height: 720 }];
  const before = structuredClone(existing);
  const row = [
    { x: 100, y: 760, ...size },
    { x: 900, y: 760, ...size },
    { x: 1700, y: 760, ...size },
    { x: 2500, y: 760, ...size },
  ];
  for (const count of [1, 2, 3, 4]) {
    assert.deepEqual(placeVariants(source, existing, count, size), row.slice(0, count));
    assert.deepEqual(
      placeVariants(source, [...existing].reverse(), count, size),
      row.slice(0, count),
    );
  }
  assert.deepEqual(existing, before);
});

test('a row in the way of another frame moves down past it whole, spacing gap included', () => {
  // A short frame under the third slot moves the row only to just below it.
  const short = { x: 1700, y: 760, width: 400, height: 100 };
  assert.deepEqual(
    placeVariants(source, [source, short], 3, size).map(({ x, y }) => ({ x, y })),
    [
      { x: 100, y: 940 },
      { x: 900, y: 940 },
      { x: 1700, y: 940 },
    ],
  );
  // This frame does not overlap the first slot there but is within its 80 px resting gap.
  const existing = [source, short, { x: -630, y: 1000, ...size }];
  const before = structuredClone(existing);
  assert.deepEqual(placeVariants(source, existing, 3, size), [
    { x: 100, y: 1800, ...size },
    { x: 900, y: 1800, ...size },
    { x: 1700, y: 1800, ...size },
  ]);
  assert.deepEqual(existing, before);
});

test('a second set of variants lands in a row below the first', () => {
  const first = placeVariants(source, [source], 3, size);
  assert.deepEqual(
    placeVariants(source, [source, ...first], 3, size).map(({ x, y }) => ({ x, y })),
    [
      { x: 100, y: 1560 },
      { x: 900, y: 1560 },
      { x: 1700, y: 1560 },
    ],
  );
});
