import assert from 'node:assert/strict';
import test from 'node:test';
import type { PlaceDrag } from './tileDrag';
import type { Tile, TileGrid } from './tileGrid';
import { assignPanes, pointerZone, tileDrop, type PaneSlot } from './tileLayout';

function tile(id: string, appSessionId = id): Tile {
  return { id, page: { kind: 'chat', appSessionId } };
}

function grid(...columns: string[][]): TileGrid {
  return {
    columns: columns.map((ids) => ({ tiles: ids.map((id) => tile(id)), rowSplit: 0.5 })),
    columnSplit: 0.5,
    focusedTileId: columns[0][0],
  };
}

function slots(panes: PaneSlot[]): Record<string, number> {
  return Object.fromEntries(panes.map((pane) => [pane.tileId, pane.slot]));
}

test('panes follow their tiles, so moving, splitting or closing one leaves the others mounted', () => {
  // The unsplit page becomes a grid tile showing the same chat, in the same pane.
  const unsplit = assignPanes([], [tile('page', 'a')]);
  const split = assignPanes(unsplit, [tile('t1', 'a'), tile('t2', 'b')]);
  assert.deepEqual(slots(split), { t1: 0, t2: 1 });

  const swapped = assignPanes(split, [tile('t2', 'b'), tile('t1', 'a')]);
  assert.deepEqual(slots(swapped), { t1: 0, t2: 1 });

  const closed = assignPanes(swapped, [tile('t2', 'b')]);
  const added = assignPanes(closed, [tile('t2', 'b'), tile('t3', 'c')]);
  assert.deepEqual(slots(added), { t2: 1, t3: 0 });
});

test('a drop splits at an edge, takes the place at the center, and moves a tile already shown', () => {
  const two = grid(['a'], ['b']);
  const chat = (appSessionId: string): PlaceDrag => ({ kind: 'chat', appSessionId });

  assert.equal(pointerZone(0.1, 0.5), 'left');
  assert.equal(pointerZone(0.5, 0.9), 'bottom');
  assert.equal(pointerZone(0.5, 0.5), 'center');

  assert.deepEqual(tileDrop(two, chat('c'), 'a', 'bottom'), {
    kind: 'split',
    appSessionId: 'c',
    edge: 'bottom',
  });
  // Two columns are the most a tab holds.
  assert.equal(tileDrop(two, chat('c'), 'a', 'left'), null);
  assert.deepEqual(tileDrop(two, chat('c'), 'a', 'center'), { kind: 'show', appSessionId: 'c' });

  assert.deepEqual(tileDrop(two, chat('b'), 'a', 'center'), {
    kind: 'move',
    tileId: 'b',
    edge: 'center',
  });
  assert.equal(tileDrop(two, { kind: 'tile', tileId: 'a' }, 'a', 'bottom'), null);
});
