import assert from 'node:assert/strict';
import test from 'node:test';
import { moveTile, nextSplit, splitTile, type Tile, type TileGrid } from './tileGrid';

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
