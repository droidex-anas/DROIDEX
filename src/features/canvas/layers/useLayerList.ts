import { useEffect, useEffectEvent, useRef, type RefObject } from 'react';
import { defaultRangeExtractor, useVirtualizer } from '@tanstack/react-virtual';

/**
 * The tree's virtual list of `keys`, each `rowPx` tall. The `kept` rows stay
 * mounted wherever the list scrolls, as aria-activedescendant names the
 * keyboard's row and a field holds its draft, and the row the keyboard moved
 * to is brought into view when it moves, and only then. A row restacked from
 * the keyboard is brought into view once the canvas's new order puts it elsewhere.
 */
export function useLayerList(
  tree: RefObject<HTMLDivElement | null>,
  keys: readonly string[],
  rowPx: number,
  kept: readonly number[],
  movedTo: string | null,
) {
  const virtualizer = useVirtualizer({
    count: keys.length,
    getScrollElement: () => tree.current,
    getItemKey: (index) => keys[index],
    estimateSize: () => rowPx,
    overscan: 8,
    // Rows paint on the first frame, before the tree has been measured.
    initialRect: { width: 0, height: rowPx * 24 },
    rangeExtractor: (range) => {
      const indexes = new Set(defaultRangeExtractor(range));
      for (const index of kept) if (index >= 0) indexes.add(index);
      return [...indexes].sort((a, b) => a - b);
    },
  });
  const revealRow = useEffectEvent((key: string) => {
    const index = keys.indexOf(key);
    if (index >= 0) virtualizer.scrollToIndex(index);
  });
  useEffect(() => {
    if (movedTo !== null) revealRow(movedTo);
  }, [movedTo]);

  /** The restacked row, and where it stood when its frame was restacked. */
  const restacked = useRef<{ key: string; index: number } | null>(null);
  useEffect(() => {
    const pending = restacked.current;
    if (!pending || keys.indexOf(pending.key) === pending.index) return;
    restacked.current = null;
    revealRow(pending.key);
  }, [keys]);
  return {
    virtualizer,
    revealRestacked: (key: string) => {
      restacked.current = { key, index: keys.indexOf(key) };
    },
  };
}
