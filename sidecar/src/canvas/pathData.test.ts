import assert from 'node:assert/strict';
import test from 'node:test';
import { isPathData, MAX_PATH_DATA_LENGTH } from './pathData.js';

test('path data is read as the SVG grammar spells it, separated by spaces and commas only', () => {
  for (const d of [
    'M0 0',
    'M10,20 L30 40 Z',
    'm1 2 3 4 5 6',
    'M0 0H10V10h-10z',
    'M.5.5-1-1L1e2 1E-2',
    'M0 0C1 2 3 4 5 6S7 8 9 10Q1 1 2 2T3 3',
    'M0 0A5 5 0 1 0 10 10a5,5,30,0,1,-5,-5',
    'M0 0a1 1 0 0110 10',
    '  M0 0 Z  M1 1 L2 2  ',
  ])
    assert.equal(isPathData(d), true, d);
  for (const d of [
    '',
    ' ',
    'L0 0',
    'M0',
    'M0 0 L1',
    'M0 0,',
    'M0 0, L1 1',
    'M0 0 X1 1',
    'M0 0A5 5 0 2 0 10 10',
    'M0\t0',
    'M0\n0',
    'M0 0"/><script>',
    'M0 0 Z 1',
    'M1e 2',
  ])
    assert.equal(isPathData(d), false, JSON.stringify(d));
  const long = 'M0 0' + ' L1 1'.repeat(MAX_PATH_DATA_LENGTH / 5);
  assert.equal(isPathData(long.slice(0, MAX_PATH_DATA_LENGTH)), false, 'cut mid-segment');
  assert.equal(isPathData(long), false, 'over the cap');
});
