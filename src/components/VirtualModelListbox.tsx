import type { ReactNode } from 'react';
import type { ModelInfo } from '@droidex/protocol';
import {
  MODEL_LIST_HEIGHT_PX,
  SelectionHighlight,
  useModelListVirtualizer,
} from './modelListParts';

export default function VirtualModelListbox({
  rows,
  selectedIndex,
  renderRow,
  children,
}: {
  rows: ModelInfo[];
  selectedIndex: number;
  renderRow: (model: ModelInfo, selected: boolean) => ReactNode;
  children: ReactNode;
}) {
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
      {children}
    </div>
  );
}
