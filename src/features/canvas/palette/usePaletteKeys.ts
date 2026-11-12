import { useState, type KeyboardEvent } from 'react';

/**
 * The match the keyboard is on, for a search field that keeps the keyboard:
 * the arrows walk the matches, Enter adds the one it is on, and Escape clears
 * the search, then hands the keyboard back to the board.
 */
export function usePaletteKeys({
  query,
  onQuery,
  count,
  optionId,
  onAdd,
  onLeave,
}: {
  query: string;
  onQuery: (query: string) => void;
  /** How many matches the query finds. */
  count: number;
  optionId: (index: number) => string;
  onAdd: (index: number) => void;
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
    if (event.nativeEvent.isComposing) return;
    const step = { ArrowDown: 1, ArrowUp: -1 }[event.key];
    if (step !== undefined && count > 0) {
      event.preventDefault();
      moveTo((activeIndex + step + count) % count);
    } else if (event.key === 'Enter' && activeIndex >= 0) {
      event.preventDefault();
      if (!event.repeat) onAdd(activeIndex);
    } else if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      if (query === '') onLeave();
      else search('');
    }
  };
  return { activeIndex, setActive, search, onKeyDown };
}
