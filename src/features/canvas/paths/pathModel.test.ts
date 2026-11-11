import assert from 'node:assert/strict';
import test from 'node:test';
import { readPathData } from './pathData';
import { moveGrip, pathGrips, writePath, type Point } from './pathModel';

function segments(d: string) {
  const read = readPathData(d, 'source');
  assert.ok(read, d);
  return read;
}

/** The path with its `index`th grip, in path order, moved by `delta`. */
function moved(d: string, index: number, delta: Point): string {
  const read = segments(d);
  const moved = writePath(moveGrip(read, pathGrips(read)[index], delta));
  assert.ok(readPathData(moved, 'board'), `board path data: ${moved}`);
  return moved;
}

test('path data reads and writes back with its commands and numbers as written, spaced for an edit', () => {
  for (const [source, written] of [
    ['M10,20 L30 40 Z', 'M10 20 L30 40 Z'],
    ['m1 2 3 4 5 6', 'm1 2 3 4 5 6'],
    ['M0 0\n  C1 2,3 4,5 6\tS.5.5 1e2 -1', 'M0 0 C1 2 3 4 5 6 S.5 .5 1e2 -1'],
    ['M0 0a1 1 0 0110 10', 'M0 0 a1 1 0 0 1 10 10'],
    ['M0 0H10V-10h-10z', 'M0 0 H10 V-10 h-10 z'],
  ])
    assert.equal(writePath(segments(source)), written);
});

test('a path has an anchor at each segment end and a handle at each control point it writes', () => {
  const grips = pathGrips(segments('M0 0 C1 2 3 4 5 6 Q7 8 9 10 Z'));
  assert.deepEqual(
    grips.map(({ kind, point, anchors }) => [kind, point, anchors]),
    [
      ['anchor', { x: 0, y: 0 }, []],
      ['handle', { x: 1, y: 2 }, [{ x: 0, y: 0 }]],
      ['handle', { x: 3, y: 4 }, [{ x: 5, y: 6 }]],
      ['anchor', { x: 5, y: 6 }, []],
      [
        'handle',
        { x: 7, y: 8 },
        [
          { x: 5, y: 6 },
          { x: 9, y: 10 },
        ],
      ],
      ['anchor', { x: 9, y: 10 }, []],
    ],
  );
  // An arc, a horizontal and a vertical line move by their end alone.
  assert.deepEqual(
    pathGrips(segments('M0 0 A5 5 0 0 1 10 0 H20 V5')).map(({ kind }) => kind),
    ['anchor', 'anchor', 'anchor', 'anchor'],
  );
});

test('a moved grip rewrites only the numbers it moves, at two decimals, and keeps every other point drawn', () => {
  assert.equal(moved('M0 0 L10 10 L20 0', 1, { x: 1.234, y: -2 }), 'M0 0 L11.23 8 L20 0');
  // A relative segment after the anchor is written again so its end stays put.
  assert.equal(moved('m0 0 l10 10 l10 -10', 1, { x: 5, y: 0 }), 'm0 0 l15 10 l5 -10');
  // An anchor carries the cubic handles on either side of it; a handle moves alone.
  const curve = 'M0 0 C0 10 10 10 10 0 C10 -10 20 -10 20 0';
  assert.equal(moved(curve, 3, { x: 1, y: 1 }), 'M0 0 C0 10 11 11 11 1 C11 -9 20 -10 20 0');
  assert.equal(moved(curve, 1, { x: 2, y: 0 }), 'M0 0 C2 10 10 10 10 0 C10 -10 20 -10 20 0');
  // A horizontal line's anchor moves along x only, and the vertical after it follows.
  assert.equal(moved('M0 0 H10 V10', 1, { x: 3, y: 5 }), 'M0 0 H13 V10');
  assert.equal(moved('M0 0 A5 5 0 0 1 10 0', 1, { x: 0, y: 2 }), 'M0 0 A5 5 0 0 1 10 2');
  assert.equal(moved('M0 0 L1 1', 1, { x: -1.001, y: 0 }), 'M0 0 L0 1');
});
