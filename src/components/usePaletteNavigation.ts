import { useEffect, useRef, useState } from 'react';

// Shared arrow-key navigation for the command-palette overlays (⌘K command
// palette, sidebar session search): selection wraps around, resets whenever
// the query changes, Enter activates the selected entry, Escape closes. A row
// selected from the keyboard is scrolled into view; a hovered row is not.
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
  const [selection, setSelection] = useState({ index: 0, reveal: false });
  const selectedRowRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    setSelection({ index: 0, reveal: true });
  }, [query]);

  useEffect(() => {
    if (selection.reveal) selectedRowRef.current?.scrollIntoView({ block: 'nearest' });
  }, [selection]);

  const setSelected = (index: number) => {
    if (index !== selection.index) setSelection({ index, reveal: false });
  };

  const moveSelection = (step: number) => {
    if (entries.length === 0) return;
    setSelection((prev) => ({
      index: (prev.index + step + entries.length) % entries.length,
      reveal: true,
    }));
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
      const entry = entries.at(selection.index);
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

  return { selected: selection.index, selectedRowRef, setSelected, handleKeyDown };
}
