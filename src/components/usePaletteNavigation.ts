import { useEffect, useRef, useState } from 'react';

// Shared arrow-key navigation for the command-palette overlays (⌘K command
// palette, sidebar session search): selection wraps around, resets whenever
// the query changes, stays on a row when the list shrinks, Enter activates the
// selected entry, Escape closes. A row selected from the keyboard is kept in
// view as rows load or resize; a hovered row is not scrolled.
// Rows should select on mouse move, not mouseenter, which fires as rows scroll
// under a resting pointer and would take the keyboard selection back.
export function usePaletteNavigation<Entry>(
  query: string,
  entries: Entry[],
  onEnter: (entry: Entry) => void,
  onClose: () => void,
): {
  selected: number;
  selectedRowRef: React.RefObject<HTMLButtonElement | null>;
  setSelected: (index: number) => void;
  handleKeyDown: (e: React.KeyboardEvent) => void;
} {
  const [selection, setSelection] = useState({ query, index: 0, fromKeyboard: true });
  const selectedRowRef = useRef<HTMLButtonElement>(null);

  const isCurrentQuery = selection.query === query;
  const selected = isCurrentQuery ? Math.min(selection.index, Math.max(entries.length - 1, 0)) : 0;
  const fromKeyboard = !isCurrentQuery || selection.fromKeyboard;

  useEffect(() => {
    if (fromKeyboard) selectedRowRef.current?.scrollIntoView({ block: 'nearest' });
  }, [fromKeyboard, selected, entries]);

  const setSelected = (index: number) => {
    if (index !== selected || fromKeyboard) setSelection({ query, index, fromKeyboard: false });
  };

  const moveSelection = (step: number) => {
    if (entries.length === 0) return;
    const index = (selected + step + entries.length) % entries.length;
    setSelection({ query, index, fromKeyboard: true });
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      moveSelection(1);
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      moveSelection(-1);
    }
    if (e.key === 'Enter') {
      const entry = entries.at(selected);
      if (!entry) return;
      // Activation can close the palette and restore focus to its opener.
      e.preventDefault();
      onEnter(entry);
    }
    if (e.key === 'Escape') {
      e.preventDefault();
      onClose();
    }
  };

  return { selected, selectedRowRef, setSelected, handleKeyDown };
}
