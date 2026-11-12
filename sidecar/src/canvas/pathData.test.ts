import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';
import { readPathData } from '../../../src/features/canvas/paths/pathData.js';
import { isPathData, MAX_PATH_DATA_LENGTH } from './pathData.js';

// The preview reads path data in its own runtime, by the same rule.
const preview = createRequire(import.meta.url)('../../../electron/canvasPreviewSvg.cjs') as {
  isPathData: (d: string, spacing: 'board' | 'source') => boolean;
};

const PATH_DATA = [
  'M0 0',
  'M10,20 L30 40 Z',
  'm1 2 3 4 5 6',
  'M0 0H10V10h-10z',
  'M.5.5-1-1L1e2 1E-2',
  'M0 0C1 2 3 4 5 6S7 8 9 10Q1 1 2 2T3 3',
  'M0 0A5 5 0 1 0 10 10a5,5,30,0,1,-5,-5',
  'M0 0a1 1 0 0110 10',
  '  M0 0 Z  M1 1 L2 2  ',
  'M1e38 -1e+38L1e-400 0',
];
const NOT_PATH_DATA = [
  '',
  ' ',
  'M',
  'Ee',
  'L0 0',
  'M0',
  'M0 0L',
  'M0 0 L1',
  'M0 0,',
  'M0 0, L1 1',
  'M0 0 X1 1',
  // `ſ` upper-cases to S, but no letter past ASCII is a command.
  'M0 0ſ1 1 2 2',
  'M0 0A5 5 0 2 0 10 10',
  'M0\t0',
  'M0\n0',
  'M0 0"/><script>',
  'M0 0 Z 1',
  'M1e 2',
  // Past what Chromium reads as a float, or with a larger exponent.
  'M0 0L1e999 1',
  'M0 0L1e39 1',
  'M0 0L0.1e39 1',
  'M0 0L' + '9'.repeat(39) + ' 1',
];

test('path data is read as the SVG grammar spells it, separated by spaces and commas only', () => {
  for (const d of PATH_DATA) assert.equal(isPathData(d), true, d);
  for (const d of NOT_PATH_DATA) assert.equal(isPathData(d), false, JSON.stringify(d));
  const long = 'M0 0' + ' L1 1'.repeat(MAX_PATH_DATA_LENGTH / 5);
  assert.equal(isPathData(long.slice(0, MAX_PATH_DATA_LENGTH)), false, 'cut mid-segment');
  assert.equal(isPathData(long), false, 'over the cap');
});

test('the renderer and the preview read path data by the same rule, and source data may wrap', () => {
  for (const d of [...PATH_DATA, ...NOT_PATH_DATA]) {
    const expected = isPathData(d);
    assert.equal(readPathData(d, 'board') !== null, expected, `renderer ${JSON.stringify(d)}`);
    assert.equal(preview.isPathData(d, 'board'), expected, `preview ${JSON.stringify(d)}`);
  }
  for (const [d, expected] of [
    ['M0\t0\r\n L1,\f1', true],
    ['M0 0\nL', false],
    ['M0 0\vL1 1', false],
  ] as const) {
    assert.equal(readPathData(d, 'source') !== null, expected, `renderer ${JSON.stringify(d)}`);
    assert.equal(preview.isPathData(d, 'source'), expected, `preview ${JSON.stringify(d)}`);
  }
});
