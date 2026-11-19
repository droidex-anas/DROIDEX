import { useState, type KeyboardEvent } from 'react';
import { isAddKey, isTagKey } from '../boardKeys';

type PaletteKey = 'next' | 'previous' | 'add' | 'open' | 'tag' | 'escape';

/**
 * The match the keyboard is on, for a search field that keeps the keyboard:
 * the arrows walk the matches, Enter opens the one it is on, ⌘Enter adds it
 * to the board, ⌘L tags it in the chat where the rows can be tagged, and
 * Escape clears the search, then hands the keyboard back to the board.
 */
export function usePaletteKeys({
  query,
  onQuery,
  count,
  optionId,
  onOpen,
  onAdd,
  onTag,
  onLeave,
}: {
  query: string;
  onQuery: (query: string) => void;
  /** How many matches the query finds. */
  count: number;
  optionId: (index: number) => string;
  onOpen: (index: number) => void;
  onAdd: (index: number) => void;
  /** Null where the rows cannot be tagged, so ⌘L stays the app's. */
  onTag: ((index: number) => void) | null;
  onLeave: () => void;
}) {
  const [active, setActive] = useState(0);
  const activeIndex = count === 0 ? -1 : Math.min(active, count - 1);

  const search = (next: string) => {
    onQuery(next);
    setActive(0);
  };
  const moveTo = (index: number) => {
    setActive(index);
    document.getElementById(optionId(index))?.scrollIntoView({ block: 'nearest' });
  };
  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    const key = paletteKey(event);
    if (key === null || event.nativeEvent.isComposing || (key === 'tag' && onTag === null)) return;
    event.preventDefault();
    // The search owns these keys, so the board does not tag its frames or take Escape as well.
    if (key === 'tag' || key === 'escape') event.stopPropagation();
    if (key === 'escape') {
      if (query === '') onLeave();
      else search('');
      return;
    }
    if (activeIndex < 0) return;
    if (key === 'next' || key === 'previous') {
      moveTo((activeIndex + (key === 'next' ? 1 : -1) + count) % count);
      return;
    }
    // A held key auto-repeats and would add, open or toggle again.
    if (!event.repeat) actions[key]?.(activeIndex);
  };
  const actions = { add: onAdd, open: onOpen, tag: onTag };
  return { activeIndex, setActive, search, onKeyDown };
}

function paletteKey(event: KeyboardEvent): PaletteKey | null {
  if (event.key === 'ArrowDown') return 'next';
  if (event.key === 'ArrowUp') return 'previous';
  if (isAddKey(event)) return 'add';
  if (event.key === 'Enter') return 'open';
  if (isTagKey(event)) return 'tag';
  if (event.key === 'Escape') return 'escape';
  return null;
}
