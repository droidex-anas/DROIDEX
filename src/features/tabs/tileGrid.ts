// A tab split into chat tiles: one or two columns of one or two tiles each.
// The focused tile shows the live page, as the active tab does; every other
// tile keeps the page it shows. Operations work on a grid whose focused tile
// already holds the live page, so the grid they return is complete.

import type { TabPage } from './tabStrip';

export type TilePage = Extract<TabPage, { kind: 'chat' | 'new-chat' }>;

export interface Tile {
  id: string;
  page: TilePage;
}

export interface TileColumn {
  tiles: Tile[];
  // The first tile's share of the column's height.
  rowSplit: number;
}

export interface TileGrid {
  columns: TileColumn[];
  // The first column's share of the width.
  columnSplit: number;
  focusedTileId: string;
}

export type TileEdge = 'left' | 'right' | 'top' | 'bottom';

export const MAX_COLUMNS = 2;
export const MAX_TILES_PER_COLUMN = 2;
const MIN_SPLIT = 0.2;
const EVEN_SPLIT = 0.5;

export function newTileId(): string {
  return crypto.randomUUID();
}

export function clampSplit(split: number): number {
  return Math.min(1 - MIN_SPLIT, Math.max(MIN_SPLIT, split));
}

export function gridTiles(grid: TileGrid): Tile[] {
  return grid.columns.flatMap((column) => column.tiles);
}

export function focusedTile(grid: TileGrid): Tile {
  const tiles = gridTiles(grid);
  return tiles.find((tile) => tile.id === grid.focusedTileId) ?? tiles[0];
}

export function chatTile(grid: TileGrid, appSessionId: string): Tile | undefined {
  return gridTiles(grid).find(
    (tile) => tile.page.kind === 'chat' && tile.page.appSessionId === appSessionId,
  );
}

// A grid holds at most one new chat, since the draft it edits is shared.
export function newChatTile(grid: TileGrid): Tile | undefined {
  return gridTiles(grid).find((tile) => tile.page.kind === 'new-chat');
}

export function singleTileGrid(tile: Tile): TileGrid {
  return {
    columns: [{ tiles: [tile], rowSplit: EVEN_SPLIT }],
    columnSplit: EVEN_SPLIT,
    focusedTileId: tile.id,
  };
}

function columnIndexOf(grid: TileGrid, tileId: string): number {
  return grid.columns.findIndex((column) => column.tiles.some((tile) => tile.id === tileId));
}

function mapTiles(grid: TileGrid, update: (tile: Tile) => Tile): TileGrid {
  return {
    ...grid,
    columns: grid.columns.map((column) => ({ ...column, tiles: column.tiles.map(update) })),
  };
}

export function withTilePage(grid: TileGrid, tileId: string, page: TilePage): TileGrid {
  return mapTiles(grid, (tile) => (tile.id === tileId ? { ...tile, page } : tile));
}

export function focusTile(grid: TileGrid, tileId: string): TileGrid {
  if (tileId === grid.focusedTileId || columnIndexOf(grid, tileId) === -1) return grid;
  return { ...grid, focusedTileId: tileId };
}

// Left and right add a column; top and bottom add a row to the target's column.
export function canSplit(grid: TileGrid, targetTileId: string, edge: TileEdge): boolean {
  if (edge === 'left' || edge === 'right') return grid.columns.length < MAX_COLUMNS;
  const index = columnIndexOf(grid, targetTileId);
  return index !== -1 && grid.columns[index].tiles.length < MAX_TILES_PER_COLUMN;
}

export function splitTile(
  grid: TileGrid,
  targetTileId: string,
  edge: TileEdge,
  tile: Tile,
): TileGrid {
  if (!canSplit(grid, targetTileId, edge)) return grid;
  if (edge === 'left' || edge === 'right') {
    const column: TileColumn = { tiles: [tile], rowSplit: EVEN_SPLIT };
    const columns = edge === 'left' ? [column, ...grid.columns] : [...grid.columns, column];
    return { ...grid, columns, columnSplit: EVEN_SPLIT };
  }
  const index = columnIndexOf(grid, targetTileId);
  const columns = grid.columns.map((column, columnIndex) => {
    if (columnIndex !== index) return column;
    const tiles = edge === 'top' ? [tile, ...column.tiles] : [...column.tiles, tile];
    return { tiles, rowSplit: EVEN_SPLIT };
  });
  return { ...grid, columns };
}

// Takes a tile out, closing its column if that empties. A focused tile hands
// focus to its neighbor. The last tile stays.
export function removeTile(grid: TileGrid, tileId: string): TileGrid {
  const index = columnIndexOf(grid, tileId);
  if (index === -1 || gridTiles(grid).length === 1) return grid;
  const columns = grid.columns
    .map((column, columnIndex) =>
      columnIndex === index
        ? { tiles: column.tiles.filter((tile) => tile.id !== tileId), rowSplit: EVEN_SPLIT }
        : column,
    )
    .filter((column) => column.tiles.length > 0);
  const neighbor = columns[Math.min(index, columns.length - 1)].tiles[0];
  return {
    columns,
    columnSplit: columns.length === grid.columns.length ? grid.columnSplit : EVEN_SPLIT,
    focusedTileId: tileId === grid.focusedTileId ? neighbor.id : grid.focusedTileId,
  };
}

// The center swaps two tiles; an edge moves the tile beside the target.
export function moveTile(
  grid: TileGrid,
  tileId: string,
  targetTileId: string,
  edge: TileEdge | 'center',
): TileGrid {
  const tiles = gridTiles(grid);
  const moving = tiles.find((tile) => tile.id === tileId);
  const target = tiles.find((tile) => tile.id === targetTileId);
  if (!moving || !target || moving === target) return grid;
  if (edge === 'center') {
    return mapTiles(grid, (tile) => {
      if (tile === moving) return target;
      return tile === target ? moving : tile;
    });
  }
  const without = removeTile(grid, tileId);
  if (!canSplit(without, targetTileId, edge)) return grid;
  return { ...splitTile(without, targetTileId, edge, moving), focusedTileId: grid.focusedTileId };
}

export function withColumnSplit(grid: TileGrid, split: number): TileGrid {
  const columnSplit = clampSplit(split);
  return columnSplit === grid.columnSplit ? grid : { ...grid, columnSplit };
}

export function withRowSplit(grid: TileGrid, columnIndex: number, split: number): TileGrid {
  const rowSplit = clampSplit(split);
  if (grid.columns[columnIndex]?.rowSplit === rowSplit) return grid;
  return {
    ...grid,
    columns: grid.columns.map((column, index) =>
      index === columnIndex ? { ...column, rowSplit } : column,
    ),
  };
}

// Where a new tile goes without a drop target: at the focused tile's
// `preferred` edge, else beside or under it, else under whichever column has room.
export function nextSplit(
  grid: TileGrid,
  preferred: TileEdge,
): { targetTileId: string; edge: TileEdge } | null {
  const candidates: TileEdge[] = [preferred, 'right', 'bottom'];
  const edge = candidates.find((candidate) => canSplit(grid, grid.focusedTileId, candidate));
  if (edge) return { targetTileId: grid.focusedTileId, edge };
  const open = grid.columns.find((column) => column.tiles.length < MAX_TILES_PER_COLUMN);
  return open ? { targetTileId: open.tiles[0].id, edge: 'bottom' } : null;
}

// Reading order: down each column, left to right.
export function adjacentTileId(grid: TileGrid, offset: 1 | -1): string {
  const tiles = gridTiles(grid);
  const index = tiles.findIndex((tile) => tile.id === grid.focusedTileId);
  return tiles[(index + offset + tiles.length) % tiles.length].id;
}
