// What a key means in the layers panel. The arrows, Home and End walk the rows
// without touching the selection, so a long canvas can be read row by row;
// Space toggles the row's frame in the selection, Enter takes the board to it,
// F2 renames it and Escape gives the keyboard back to the board.

import { navigationIndex } from '../../../components/ui/menuKeys';

export type LayerKey =
  | { kind: 'move'; index: number }
  | { kind: 'pick' }
  | { kind: 'focus' }
  | { kind: 'rename' }
  | { kind: 'leave' };

type KeyPress = Pick<KeyboardEvent, 'key' | 'metaKey' | 'ctrlKey' | 'altKey'>;

/** `active` is the row the keyboard is on, of `count` rows. */
export function layerKey(event: KeyPress, active: number, count: number): LayerKey | null {
  if (event.metaKey || event.ctrlKey || event.altKey) return null;
  const index = navigationIndex(event.key, active, count);
  if (index !== null) return { kind: 'move', index };
  switch (event.key) {
    case ' ':
      return { kind: 'pick' };
    case 'Enter':
      return { kind: 'focus' };
    case 'F2':
      return { kind: 'rename' };
    case 'Escape':
      return { kind: 'leave' };
    default:
      return null;
  }
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
