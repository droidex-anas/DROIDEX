import assert from 'node:assert/strict';
import test from 'node:test';
import { readPathData, type PathSegment } from './pathData';
import { movedData, moveGrip, pathGrips, type Point } from './pathModel';

function segments(d: string) {
  const read = readPathData(d, 'source');
  assert.ok(read, d);
  return read;
}

function lastAnchor(read: PathSegment[]) {
  const grip = pathGrips(read).findLast(({ kind }) => kind === 'anchor');
  assert.ok(grip);
  return grip;
}

/** The path's last anchor moved by `delta`, then by `back`; the data that writes. */
function movedLast(d: string, delta: Point, back: Point): string | null {
  const read = segments(d);
  const there = moveGrip(read, lastAnchor(read), delta);
  assert.ok(there);
  const again = moveGrip(there, lastAnchor(there), back);
  assert.ok(again);
  return movedData(read, again);
}

/** The data the path writes with its `index`th grip, in path order, moved by `delta`. */
function moved(d: string, index: number, delta: Point): string {
  const read = segments(d);
  const after = moveGrip(read, pathGrips(read)[index], delta);
  assert.ok(after);
  const written = movedData(read, after);
  assert.ok(written && readPathData(written, 'board'), `board path data: ${String(written)}`);
  return written;
}

test('a moved path is written spaced for an edit, its numbers as written; one moved back writes nothing', () => {
  for (const [source, written] of [
    ['M10,20 L30 40 Z', 'M10 20 L31 41 Z'],
    ['m1 2 3 4 5 6', 'm1 2 3 4 6 7'],
    ['M0 0\n  C1 2,3 4,5 6\tS.5.5 1e2 -1', 'M0 0 C1 2 3 4 5 6 S1.5 1.5 101 0'],
    ['M0 0a1 1 0 0110 10', 'M0 0 a1 1 0 0 1 11 11'],
    ['M1-2 .5.5', 'M1 -2 1.5 1.5'],
  ]) {
    assert.equal(movedLast(source, { x: 1, y: 1 }, { x: 0, y: 0 }), written);
    // There and back is no move, so the source stays byte for byte.
    assert.equal(movedLast(source, { x: 3.333, y: -7 }, { x: -3.333, y: 7 }), null, source);
  }
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
  assert.equal(moved('M0 0 A5 5 0 0 1 10 0', 1, { x: 0, y: 2 }), 'M0 0 A5 5 0 0 1 10 2');
  assert.equal(moved('M0 0 L1 1', 1, { x: -1.001, y: 0 }), 'M0 0 L0 1');
});

test('a point on a horizontal or vertical line moves only along it, and not at all between the two', () => {
  assert.equal(moved('M0 0 L10 10 H30 L40 40', 1, { x: 5, y: 5 }), 'M0 0 L15 10 H30 L40 40');
  assert.equal(moved('M0 0 L10 10 v20', 1, { x: 5, y: 5 }), 'M0 0 L10 15 v15');
  assert.deepEqual(
    pathGrips(segments('M0 0 H10 V10')).map(({ axes }) => axes),
    [
      { x: true, y: false },
      { x: false, y: false },
      { x: false, y: true },
    ],
  );
  // A line after a close starts from its subpath's first point.
  assert.deepEqual(pathGrips(segments('M0 0 L10 10 Z H5'))[0].axes, { x: true, y: false });
});

test('a moved number is a plain decimal, and a move past what path data holds is refused', () => {
  assert.equal(moved('M0 0 L1e21 0', 1, { x: 1e21, y: 0 }), 'M0 0 L2000000000000000000000 0');
  const read = segments('M0 0 L1e38 0');
  assert.equal(moveGrip(read, pathGrips(read)[1], { x: 2e37, y: 0 }), null);
});
