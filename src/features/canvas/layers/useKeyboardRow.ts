import { useRef, useState, type KeyboardEvent } from 'react';
import { isTypeaheadKey, typeaheadIndex } from '../../../components/ui/menuKeys';
import { activeRow } from './layerKeys';

// How long typed letters keep adding to one type-ahead query, as in a menu.
const TYPEAHEAD_RESET_MS = 500;

/**
 * The row the keyboard is on among `rows`, and what moves it besides the
 * arrows: a frame picked on the board, and letters typed to find a name. A
 * frame's row is keyed by its designId.
 */
export function useKeyboardRow(
  rows: readonly { key: string; name: string }[],
  selectedFrameIds: readonly string[],
) {
  const [movedTo, setMovedTo] = useState<string | null>(null);
  const keys = rows.map((row) => row.key);
  // A frame picked on the board takes the keyboard's row to it. A pick made here is where
  // the row already is, and taking a frame out of the selection moves nothing.
  const [seenSelection, setSeenSelection] = useState(selectedFrameIds);
  if (seenSelection !== selectedFrameIds) {
    setSeenSelection(selectedFrameIds);
    const picked = selectedFrameIds.filter((designId) => !seenSelection.includes(designId));
    const last = picked.at(-1);
    if (last !== undefined) {
      if (!picked.some((designId) => designId === movedTo)) setMovedTo(last);
    } else if (movedTo === null) {
      // The keyboard stood on a selected frame; it stays there as that frame leaves the selection.
      const was = activeRow(keys, null, seenSelection);
      if (was >= 0) setMovedTo(keys[was]);
    }
  } else if (movedTo !== null && !keys.includes(movedTo)) {
    setMovedTo(null);
  }
  const typeahead = useRef({ query: '', resetAt: 0 });
  const activeIndex = activeRow(keys, movedTo, selectedFrameIds);

  /** Moves to the next row whose name starts with what was typed; false for a key that types nothing. */
  const typeTo = (event: KeyboardEvent): boolean => {
    if (!isTypeaheadKey(event)) return false;
    const now = Date.now();
    const query = now < typeahead.current.resetAt ? typeahead.current.query + event.key : event.key;
    typeahead.current = { query, resetAt: now + TYPEAHEAD_RESET_MS };
    const match = typeaheadIndex(
      rows.map((row) => row.name),
      query,
      activeIndex,
    );
    if (match < 0) return false;
    setMovedTo(rows[match].key);
    return true;
  };
  return { movedTo, activeIndex, moveTo: setMovedTo, typeTo };
}
