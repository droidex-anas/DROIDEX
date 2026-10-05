import assert from 'node:assert/strict';
import test from 'node:test';
import { canSplit, moveTile, nextSplit, splitTile, type Tile, type TileGrid } from './tileGrid';

function tile(appSessionId: string): Tile {
  return { id: appSessionId, page: { kind: 'chat', appSessionId } };
}

// Columns of tile ids, top to bottom; the first tile is focused.
function grid(...columns: string[][]): TileGrid {
  return {
    columns: columns.map((ids) => ({ tiles: ids.map(tile), rowSplit: 0.5 })),
    columnSplit: 0.5,
    focusedTileId: columns[0][0],
  };
}

function layout(value: TileGrid): string[][] {
  return value.columns.map((column) => column.tiles.map((entry) => entry.id));
}

test('a new tile goes where asked, else wherever there is room, until two columns of two are full', () => {
  assert.deepEqual(nextSplit(grid(['a']), 'right'), { targetTileId: 'a', edge: 'right' });
  assert.deepEqual(nextSplit(grid(['a']), 'bottom'), { targetTileId: 'a', edge: 'bottom' });
  assert.deepEqual(nextSplit(grid(['a'], ['b']), 'right'), { targetTileId: 'a', edge: 'bottom' });
  assert.deepEqual(nextSplit(grid(['a', 'c']), 'bottom'), { targetTileId: 'a', edge: 'right' });
  assert.deepEqual(nextSplit(grid(['a', 'c'], ['b']), 'right'), {
    targetTileId: 'b',
    edge: 'bottom',
  });

  const full = grid(['a', 'c'], ['d', 'b']);
  assert.equal(nextSplit(full, 'right'), null);
  assert.equal(splitTile(full, 'a', 'left', tile('e')), full);
  assert.equal(splitTile(full, 'a', 'bottom', tile('e')), full);
});

test('a tile dropped on an edge moves beside the target, and on the center swaps', () => {
  const full = grid(['a', 'c'], ['d', 'b']);
  const swapped = moveTile(full, 'a', 'b', 'center');
  assert.deepEqual(layout(swapped), [
    ['b', 'c'],
    ['d', 'a'],
  ]);
  assert.equal(swapped.focusedTileId, 'a');

  assert.equal(moveTile(full, 'a', 'b', 'bottom'), full);
  assert.deepEqual(layout(moveTile(full, 'c', 'a', 'top')), [
    ['c', 'a'],
    ['d', 'b'],
  ]);

  // Moving a column's only tile closes that column.
  assert.deepEqual(layout(moveTile(grid(['a'], ['b']), 'a', 'b', 'bottom')), [['b', 'a']]);
  assert.deepEqual(layout(moveTile(grid(['a', 'b']), 'b', 'a', 'right')), [['a'], ['b']]);
});

test('a split with a missing target leaves the grid alone on every edge', () => {
  const value = grid(['a']);
  for (const edge of ['left', 'right', 'top', 'bottom'] as const) {
    assert.equal(canSplit(value, 'missing', edge), false);
    assert.equal(splitTile(value, 'missing', edge, tile('b')), value);
  }
});

test('moving a tile between two single-tile columns keeps the column split', () => {
  const value = grid(['a'], ['b']);
  value.columnSplit = 0.3;

  const moved = moveTile(value, 'a', 'b', 'right');
  assert.deepEqual(layout(moved), [['b'], ['a']]);
  assert.equal(moved.columnSplit, 0.3);
  assert.equal(moved.focusedTileId, 'a');
});

test('reordering rows keeps both the moved and untouched columns resized', () => {
  const value = grid(['a', 'c'], ['d', 'b']);
  value.columnSplit = 0.3;
  value.columns[0].rowSplit = 0.4;
  value.columns[1].rowSplit = 0.7;

  const moved = moveTile(value, 'c', 'a', 'top');
  assert.deepEqual(layout(moved), [
    ['c', 'a'],
    ['d', 'b'],
  ]);
  assert.equal(moved.columnSplit, 0.3);
  assert.deepEqual(
    moved.columns.map((column) => column.rowSplit),
    [0.4, 0.7],
  );
});

test('an untouched column keeps its row split when it moves to the other side', () => {
  const value = grid(['a'], ['b', 'c']);
  value.columnSplit = 0.3;
  value.columns[1].rowSplit = 0.7;

  const moved = moveTile(value, 'a', 'c', 'right');
  assert.deepEqual(layout(moved), [['b', 'c'], ['a']]);
  assert.equal(moved.columns[0].rowSplit, 0.7);
  assert.equal(moved.columnSplit, 0.3);
});

test('moving between columns rebalances their rows while keeping the column split', () => {
  const value = grid(['a', 'c'], ['b']);
  value.columnSplit = 0.3;
  value.columns[0].rowSplit = 0.4;
  value.columns[1].rowSplit = 0.7;

  const moved = moveTile(value, 'c', 'b', 'top');
  assert.deepEqual(layout(moved), [['a'], ['c', 'b']]);
  assert.equal(moved.columnSplit, 0.3);
  assert.deepEqual(
    moved.columns.map((column) => column.rowSplit),
    [0.5, 0.5],
  );
});

test('moving between one and two columns rebalances the created and removed splits', () => {
  const value = grid(['a'], ['b']);
  value.columnSplit = 0.3;
  value.columns[1].rowSplit = 0.7;

  const stacked = moveTile(value, 'a', 'b', 'bottom');
  assert.deepEqual(layout(stacked), [['b', 'a']]);
  assert.equal(stacked.columnSplit, 0.5);
  assert.equal(stacked.columns[0].rowSplit, 0.5);

  stacked.columnSplit = 0.3;
  stacked.columns[0].rowSplit = 0.7;
  const sideBySide = moveTile(stacked, 'a', 'b', 'right');
  assert.deepEqual(layout(sideBySide), [['b'], ['a']]);
  assert.equal(sideBySide.columnSplit, 0.5);
  assert.deepEqual(
    sideBySide.columns.map((column) => column.rowSplit),
    [0.5, 0.5],
  );
});
