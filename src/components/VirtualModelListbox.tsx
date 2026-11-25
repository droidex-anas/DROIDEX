import { useEffect, useRef, type ReactNode } from 'react';
import type { ModelInfo } from '@droidex/protocol';
import { useVirtualizer } from '@tanstack/react-virtual';

const ROW_H = 40;
// Five rows. The height holds whatever the list shows, so a search or another
// harness's catalog never resizes the picker under the pointer.
const MODEL_LIST_HEIGHT_PX = 200;

export default function VirtualModelListbox({
  models,
  hasRealModels,
  selectedModelId,
  query,
  renderRow,
}: {
  models: ModelInfo[];
  hasRealModels: boolean;
  selectedModelId: string | undefined;
  query: string;
  renderRow: (model: ModelInfo, selected: boolean) => ReactNode;
}) {
  const rows = hasRealModels ? models : [];
  // -1 when the active model is filtered out: nothing is highlighted then.
  const selectedIndex = rows.findIndex((model) => model.id === selectedModelId);
  const { scrollRef, virtualizer } = useModelListVirtualizer(rows.length, selectedIndex);

  return (
    <div
      ref={scrollRef}
      className="-mx-1 min-h-0 overflow-y-auto overscroll-contain px-1"
      style={{ height: MODEL_LIST_HEIGHT_PX }}
    >
      <div
        role="listbox"
        aria-label="Models"
        className="relative"
        style={{ height: `${String(virtualizer.getTotalSize())}px` }}
      >
        <SelectionHighlight index={selectedIndex} />
        {virtualizer.getVirtualItems().map((item) => {
          const model = rows[item.index];
          return (
            <div
              key={model.id}
              className="absolute inset-x-0 top-0"
              style={{ transform: `translateY(${String(item.start)}px)` }}
            >
              {renderRow(model, item.index === selectedIndex)}
            </div>
          );
        })}
      </div>
      <ModelListStatus hasRealModels={hasRealModels} empty={models.length === 0} query={query} />
    </div>
  );
}

/** Opens with the selected row in view and follows it; -1 returns to the top. */
function useModelListVirtualizer(count: number, selectedIndex: number) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const virtualizer = useVirtualizer({
    count,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_H,
    overscan: 4,
    initialRect: { width: 0, height: MODEL_LIST_HEIGHT_PX },
    initialOffset: Math.max(0, selectedIndex * ROW_H - MODEL_LIST_HEIGHT_PX / 2 + ROW_H / 2),
  });

  useEffect(() => {
    if (selectedIndex < 0) virtualizer.scrollToOffset(0);
    else virtualizer.scrollToIndex(selectedIndex, { align: 'auto' });
  }, [selectedIndex, virtualizer]);

  return { scrollRef, virtualizer };
}

/** The filled row behind the selection, sliding between rows as it changes. */
function SelectionHighlight({ index }: { index: number }) {
  return (
    <div
      aria-hidden
      className={`pointer-events-none absolute inset-x-0 top-0 h-10 rounded-md bg-active dark:bg-surface ${
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
function ModelListStatus({
  hasRealModels,
  empty,
  query,
}: {
  hasRealModels: boolean;
  empty: boolean;
  query: string;
}) {
  if (!hasRealModels) {
    return <div className="px-2 py-3 text-center text-caption text-muted">Loading models…</div>;
  }
  if (!empty) return null;
  return (
    <div className="px-2 py-3 text-center text-caption text-muted">No matches for “{query}”</div>
  );
}
