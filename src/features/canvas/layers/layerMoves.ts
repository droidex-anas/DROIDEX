// Where a layer of the panel can move to, read off the rows as they show:
// dropped at a boundary between rows, at the depth the pointer chooses, or
// stepped from the keyboard among its siblings, out of its parent or into the
// layer above. The sidecar refuses what the source cannot take; these refuse
// early only what the rows already say, so a drag shows it before the drop.

import type { ElementEntry } from './ElementRow';
import type { LayerEntry } from './layerRows';

/** Into the element row `parentId`, before its child row `beforeId`, or last for null. */
export interface LayerPlace {
  parentId: string;
  beforeId: string | null;
}

export type LayerDrop =
  | { state: 'drop'; place: LayerPlace }
  | { state: 'refused'; reason: string }
  /** The layer is there already, so the drop changes nothing. */
  | { state: 'still' };

/** A drop at the boundary before row `gap`, at tree level `level`. */
export interface DropLine {
  gap: number;
  level: number;
  drop: LayerDrop;
}

export type LayerStep = 'up' | 'down' | 'out' | 'in';

const VOID_TAGS = new Set([
  'area',
  'base',
  'br',
  'col',
  'embed',
  'hr',
  'img',
  'input',
  'link',
  'meta',
  'param',
  'source',
  'track',
  'wbr',
]);

/** A layer written once, as a whole JSX child of another element, so it can be cut and pasted. */
export function isMovable(row: LayerEntry): row is ElementEntry {
  if (row.kind !== 'element' || row.inText) return false;
  const { free, parentId, lock } = row.node;
  return free && parentId !== null && lock !== 'repeated' && lock !== 'shared';
}

/** A row of the frame's outline, which an edit can name; a drawn element the outline does not write has none. */
export function isOutlineRow(row: LayerEntry): row is ElementEntry {
  return row.kind === 'element' && !row.node.nodeId.startsWith('@');
}

/**
 * Where the layer on row `subject` drops with the pointer `at` rows down the
 * list and asking for tree level `level`: the nearest boundary within its own
 * frame, at the nearest level that boundary allows.
 */
export function dropLine(
  rows: readonly LayerEntry[],
  subject: number,
  at: number,
  level: number,
): DropLine {
  const { start, end } = frameRange(rows, subject);
  const gap = clamp(Math.round(at), start + 1, end);
  const above = rows[gap - 1];
  const below = gap < end ? rows[gap] : undefined;
  const min = below?.level ?? 2;
  const max = Math.max(min, above.kind === 'element' ? above.level + 1 : above.level);
  const shown = clamp(level, min, max);
  return { gap, level: shown, drop: dropAt(rows, subject, gap, shown) };
}

/** Where the keyboard's step takes the layer on row `subject`; null where it has nowhere to go. */
export function stepPlace(
  rows: readonly LayerEntry[],
  subject: number,
  step: LayerStep,
): LayerPlace | null {
  const row = rows[subject];
  if (!isMovable(row) || !isBuilt(row) || row.node.parentId === null) return null;
  const siblings = siblingsOf(rows, row);
  const at = siblings.indexOf(row);
  switch (step) {
    case 'up': {
      const previous = siblings.slice(0, at).findLast(isFree);
      return previous ? { parentId: row.node.parentId, beforeId: previous.node.nodeId } : null;
    }
    case 'down': {
      const next = siblings.slice(at + 1).findIndex(isFree);
      if (next < 0) return null;
      return { parentId: row.node.parentId, beforeId: firstFree(siblings, at + next + 2) };
    }
    case 'out':
      return outPlace(rows, row);
    case 'in': {
      if (at === 0) return null;
      const previous = siblings[at - 1];
      if (!canHold(previous)) return null;
      return { parentId: previous.node.nodeId, beforeId: null };
    }
  }
}

/** Just after the layer's parent, among the parent's own siblings. */
function outPlace(rows: readonly LayerEntry[], row: ElementEntry): LayerPlace | null {
  const parent = rows.find((each) => each.key === row.parentKey);
  if (parent?.kind !== 'element') return null;
  const holder = rows.find((each) => each.key === parent.parentKey);
  if (!holder || !canHold(holder)) return null;
  const outer = siblingsOf(rows, parent);
  return { parentId: holder.node.nodeId, beforeId: firstFree(outer, outer.indexOf(parent) + 1) };
}

function dropAt(
  rows: readonly LayerEntry[],
  subject: number,
  gap: number,
  level: number,
): LayerDrop {
  const row = rows[subject];
  if (!isMovable(row)) return refused('This layer can’t move.');
  if (!isBuilt(row)) return refused('Wait until this frame has built.');
  const holder = holderAt(rows, gap, level);
  if (holder >= subject && holder < subtreeEnd(rows, subject))
    return refused('A layer can’t move into itself.');
  const parent = rows[holder];
  if (!canHold(parent)) return refused(holdRefusal(parent));
  const below = rows.at(gap);
  const before = below?.level === level ? below : null;
  if (parent.key === row.parentKey && isInPlace(rows, row, before)) return { state: 'still' };
  if (before && !isFree(before)) return refused('A layer can’t go there.');
  return {
    state: 'drop',
    place: { parentId: parent.node.nodeId, beforeId: before?.node.nodeId ?? null },
  };
}

function refused(reason: string): LayerDrop {
  return { state: 'refused', reason };
}

/** The row holding a drop at boundary `gap` and `level`: the nearest row above it a level out. */
function holderAt(rows: readonly LayerEntry[], gap: number, level: number): number {
  let holder = gap - 1;
  while (rows[holder].level !== level - 1) holder -= 1;
  return holder;
}

/** Among its own siblings, just before itself or the one after it, a layer stays where it is. */
function isInPlace(rows: readonly LayerEntry[], row: ElementEntry, before: LayerEntry | null) {
  const next = rows.at(subtreeEnd(rows, rows.indexOf(row)));
  const nextSibling = next?.kind === 'element' && next.parentKey === row.parentKey ? next : null;
  return before === row || before === nextSibling;
}

/** An element written in the source, once, that can have children and has no text of its own. */
function canHold(row: LayerEntry): row is ElementEntry {
  if (!isOutlineRow(row)) return false;
  const { kind, lock, name, text, contentFromProps } = row.node;
  return (
    kind === 'element' &&
    lock !== 'repeated' &&
    lock !== 'shared' &&
    text === null &&
    !contentFromProps &&
    !VOID_TAGS.has(name)
  );
}

/** Why a row that can't hold a dropped layer can't. */
function holdRefusal(row: LayerEntry): string {
  if (row.kind !== 'element') return 'A layer can move only inside another layer.';
  const { kind, text, contentFromProps } = row.node;
  if (kind === 'element' && text !== null)
    return 'This layer sits inside text. Edit the text instead.';
  if (contentFromProps)
    return 'This layer’s props may set its content, so it can’t hold other layers.';
  return 'This layer can’t hold other layers.';
}

/** The rows show the frame's current revision, which a move must name. */
function isBuilt(row: ElementEntry): boolean {
  return row.frame.build.status === 'ready';
}

function isFree(row: LayerEntry): row is ElementEntry {
  return row.kind === 'element' && row.node.free;
}

/** The first free row of `siblings` from `from` on, as a move's `beforeId`; null for none. */
function firstFree(siblings: readonly ElementEntry[], from: number): string | null {
  return siblings.slice(from).find(isFree)?.node.nodeId ?? null;
}

/** The element rows sharing `row`'s parent, in order. */
function siblingsOf(rows: readonly LayerEntry[], row: ElementEntry): ElementEntry[] {
  return rows.filter(
    (each): each is ElementEntry => each.kind === 'element' && each.parentKey === row.parentKey,
  );
}

/** The frame row holding row `index`, and the index past its last layer. */
function frameRange(rows: readonly LayerEntry[], index: number): { start: number; end: number } {
  let start = index;
  while (start > 0 && rows[start].kind !== 'frame') start -= 1;
  let end = start + 1;
  while (end < rows.length && rows[end].kind !== 'frame') end += 1;
  return { start, end };
}

/** The index past the last row that `index`'s row holds. */
function subtreeEnd(rows: readonly LayerEntry[], index: number): number {
  let end = index + 1;
  while (end < rows.length && rows[end].level > rows[index].level) end += 1;
  return end;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}
