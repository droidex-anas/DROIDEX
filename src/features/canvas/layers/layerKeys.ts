// What a key means in the layers panel, whose rows run front to back. The
// arrows, Home and End walk the rows without touching the selection, so a long
// canvas can be read row by row; Right opens a row's children and Left closes
// them. Space toggles the row's frame in the selection, Enter takes the board
// to it, F2 renames it, ⇧⌘H hides or shows it, ⌥↑ and ⌥↓ move it a row toward
// the front or back, ⌥← moves a layer out of its parent and ⌥→ into the layer
// above it, Delete removes a layer and ⌘D copies it, and Escape gives the
// keyboard back to the board.

import { navigationIndex } from '../../../components/ui/menuKeys';
import { formatChord, matchesChord } from '../../../lib/shortcuts';

export type LayerKey =
  | { kind: 'move'; index: number }
  | { kind: 'open' }
  | { kind: 'close' }
  | { kind: 'restack'; index: number }
  | { kind: 'outdent' }
  | { kind: 'indent' }
  | { kind: 'pick' }
  | { kind: 'focus' }
  | { kind: 'rename' }
  | { kind: 'toggle-hidden' }
  | { kind: 'remove' }
  | { kind: 'duplicate' }
  | { kind: 'leave' };

/** ⇧⌘H, as in a design tool; Ctrl+Shift+H off the Mac. */
const HIDE_CHORD = 'Meta+Shift+H';
export const HIDE_KEY_LABEL = formatChord(HIDE_CHORD);
/** ⌘D, as in a design tool; Ctrl+D off the Mac. */
const DUPLICATE_CHORD = 'Meta+D';
export const DUPLICATE_KEY_LABEL = formatChord(DUPLICATE_CHORD);

const PLAIN_KEYS = new Map<string, LayerKey>([
  ['ArrowRight', { kind: 'open' }],
  ['ArrowLeft', { kind: 'close' }],
  [' ', { kind: 'pick' }],
  ['Enter', { kind: 'focus' }],
  ['F2', { kind: 'rename' }],
  ['Backspace', { kind: 'remove' }],
  ['Delete', { kind: 'remove' }],
  ['Escape', { kind: 'leave' }],
]);

type KeyPress = Pick<KeyboardEvent, 'key' | 'code' | 'metaKey' | 'ctrlKey' | 'altKey' | 'shiftKey'>;

/** `active` is the row the keyboard is on, of `count` rows. */
export function layerKey(event: KeyPress, active: number, count: number): LayerKey | null {
  if (matchesChord(event, HIDE_CHORD)) return { kind: 'toggle-hidden' };
  if (matchesChord(event, DUPLICATE_CHORD)) return { kind: 'duplicate' };
  if (matchesChord(event, 'Alt+ArrowUp'))
    return active > 0 ? { kind: 'restack', index: active - 1 } : null;
  if (matchesChord(event, 'Alt+ArrowDown'))
    return active < count - 1 ? { kind: 'restack', index: active + 1 } : null;
  if (matchesChord(event, 'Alt+ArrowLeft')) return { kind: 'outdent' };
  if (matchesChord(event, 'Alt+ArrowRight')) return { kind: 'indent' };
  if (event.metaKey || event.ctrlKey || event.altKey) return null;
  const index = navigationIndex(event.key, active, count);
  if (index !== null) return { kind: 'move', index };
  return PLAIN_KEYS.get(event.key) ?? null;
}

/**
 * The row the keyboard is on: the one it last moved to while that frame is
 * still there, else the first selected frame, else the first row. -1 without rows.
 */
export function activeRow(
  designIds: readonly string[],
  movedTo: string | null,
  selectedFrameIds: readonly string[],
): number {
  for (const designId of [movedTo, ...selectedFrameIds]) {
    const index = designId === null ? -1 : designIds.indexOf(designId);
    if (index >= 0) return index;
  }
  return designIds.length > 0 ? 0 : -1;
}

/** `ids` with the one at `from` taken out and put back at `to`. */
export function moveRow(ids: readonly string[], from: number, to: number): string[] {
  const moved = ids.filter((_, index) => index !== from);
  moved.splice(to, 0, ids[from]);
  return moved;
}
