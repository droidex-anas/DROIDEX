import { useEffect, useRef } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';

const ROW_H = 40;
const VISIBLE_H = 200;

/**
 * The model lists' shared scroller: a fixed-height virtual list that opens
 * with the selected row in view and follows the selection as it moves.
 * `selectedIndex` is -1 when the selected model is filtered out; the list
 * then returns to its top.
 */
export function useModelListVirtualizer(count: number, selectedIndex: number) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const virtualizer = useVirtualizer({
    count,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_H,
    overscan: 4,
    initialRect: { width: 0, height: VISIBLE_H },
    initialOffset: Math.max(0, selectedIndex * ROW_H - VISIBLE_H / 2 + ROW_H / 2),
  });

  useEffect(() => {
    if (selectedIndex < 0) virtualizer.scrollToOffset(0);
    else virtualizer.scrollToIndex(selectedIndex, { align: 'auto' });
  }, [selectedIndex, virtualizer]);

  return { scrollRef, virtualizer };
}

/** The filled row behind the selection, sliding between rows as it changes. */
export function SelectionHighlight({ index }: { index: number }) {
  return (
    <div
      aria-hidden
      className={`pointer-events-none absolute inset-x-0 top-0 h-10 rounded-lg bg-droid-surface ${
        index < 0 ? 'opacity-0' : ''
      }`}
      style={{
        transform: `translateY(${String(Math.max(0, index) * ROW_H)}px)`,
        transition: 'transform .22s cubic-bezier(.16,1,.3,1), opacity .15s',
      }}
    />
  );
}

/** The line under a list that has nothing to show yet, or nothing that matches. */
export function ModelListStatus({
  hasRealModels,
  empty,
  query,
}: {
  hasRealModels: boolean;
  empty: boolean;
  query: string;
}) {
  if (!hasRealModels) {
    return (
      <div className="px-2 py-3 text-center text-[11px] text-droid-text-muted">Loading models…</div>
    );
  }
  if (!empty) return null;
  return (
    <div className="px-2 py-3 text-center text-[11px] text-droid-text-muted">
      No matches for “{query}”
    </div>
  );
}
