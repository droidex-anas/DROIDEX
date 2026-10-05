// Where a grid's tiles sit in the chat area, which mounted pane shows each
// one, and what a drop on a tile does.

import type { PlaceDrag } from './tileDrag';
import { canSplit, chatTile, moveTile, type Tile, type TileEdge, type TileGrid } from './tileGrid';

export interface TileBox {
  tile: Tile;
  columnIndex: number;
  // Fractions of the chat area.
  left: number;
  top: number;
  width: number;
  height: number;
  // Which of the chat area's edges the tile touches.
  atTop: boolean;
  atBottom: boolean;
  atLeft: boolean;
  atRight: boolean;
}

function share(count: number, index: number, split: number): number {
  if (count === 1) return 1;
  return index === 0 ? split : 1 - split;
}

export function tileBoxes(grid: TileGrid): TileBox[] {
  const boxes: TileBox[] = [];
  let left = 0;
  grid.columns.forEach((column, columnIndex) => {
    const width = share(grid.columns.length, columnIndex, grid.columnSplit);
    let top = 0;
    column.tiles.forEach((tile, rowIndex) => {
      const height = share(column.tiles.length, rowIndex, column.rowSplit);
      boxes.push({
        tile,
        columnIndex,
        left,
        top,
        width,
        height,
        atTop: rowIndex === 0,
        atBottom: rowIndex === column.tiles.length - 1,
        atLeft: columnIndex === 0,
        atRight: columnIndex === grid.columns.length - 1,
      });
      top += height;
    });
    left += width;
  });
  return boxes;
}

export interface PaneSlot {
  slot: number;
  tileId: string;
  pageKey: string;
}

function pageKey(tile: Tile): string {
  return tile.page.kind === 'chat' ? tile.page.appSessionId : 'new-chat';
}

/**
 * Gives each tile the pane that last showed it, or else its chat, so React
 * updates panes in place: a moved tile keeps its pane, and splitting or closing
 * a tile leaves the other chats mounted. A new tile takes the lowest free pane.
 */
export function assignPanes(previous: readonly PaneSlot[], tiles: readonly Tile[]): PaneSlot[] {
  const taken = new Set<number>();
  const slots = new Map<string, number>();
  const claim = (tile: Tile, matches: (entry: PaneSlot) => boolean) => {
    if (slots.has(tile.id)) return;
    const entry = previous.find((candidate) => matches(candidate) && !taken.has(candidate.slot));
    if (!entry) return;
    taken.add(entry.slot);
    slots.set(tile.id, entry.slot);
  };
  for (const tile of tiles) claim(tile, (entry) => entry.tileId === tile.id);
  for (const tile of tiles) claim(tile, (entry) => entry.pageKey === pageKey(tile));
  return tiles.map((tile) => {
    let slot = slots.get(tile.id);
    if (slot === undefined) {
      slot = 0;
      while (taken.has(slot)) slot += 1;
      taken.add(slot);
    }
    return { slot, tileId: tile.id, pageKey: pageKey(tile) };
  });
}

export type DropZone = TileEdge | 'center';

// How far into a tile, as a fraction of its size, an edge's drop zone reaches.
const EDGE_ZONE = 0.25;

/** The part of a tile under the pointer, given the pointer's position as fractions of the tile. */
export function pointerZone(x: number, y: number): DropZone {
  const distances: [TileEdge, number][] = [
    ['left', x],
    ['right', 1 - x],
    ['top', y],
    ['bottom', 1 - y],
  ];
  const [edge, distance] = distances.reduce((nearest, entry) =>
    entry[1] < nearest[1] ? entry : nearest,
  );
  return distance < EDGE_ZONE ? edge : 'center';
}

export type TileDrop =
  | { kind: 'move'; tileId: string; edge: DropZone }
  | { kind: 'split'; appSessionId: string; edge: TileEdge }
  | { kind: 'show'; appSessionId: string };

function moveDrop(
  grid: TileGrid,
  tileId: string,
  targetTileId: string,
  zone: DropZone,
): TileDrop | null {
  if (tileId === targetTileId) return null;
  if (zone !== 'center' && moveTile(grid, tileId, targetTileId, zone) === grid) return null;
  return { kind: 'move', tileId, edge: zone };
}

/**
 * What dropping `drag` on a tile's `zone` does, or null when it would change
 * nothing. A chat the grid already shows moves like its tile; another chat
 * splits the tile at an edge, or takes its place at the center.
 */
export function tileDrop(
  grid: TileGrid,
  drag: PlaceDrag,
  targetTileId: string,
  zone: DropZone,
): TileDrop | null {
  if (drag.kind === 'tile') return moveDrop(grid, drag.tileId, targetTileId, zone);
  const shown = chatTile(grid, drag.appSessionId);
  if (shown) return moveDrop(grid, shown.id, targetTileId, zone);
  if (zone === 'center') return { kind: 'show', appSessionId: drag.appSessionId };
  if (!canSplit(grid, targetTileId, zone)) return null;
  return { kind: 'split', appSessionId: drag.appSessionId, edge: zone };
}
