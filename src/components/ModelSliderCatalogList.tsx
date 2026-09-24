import { ChevronRight } from 'lucide-react';
import type { ModelInfo } from '../types/bridge';
import {
  ModelIcon,
  DroidProxyMark,
  isDroidProxyModel,
  providerOf,
  shortModelName,
} from './ModelIcon';
import { ModelListStatus, SelectionHighlight, useModelListVirtualizer } from './modelListParts';

/**
 * The slider popover's model list: the virtualized, filtered catalog, with the
 * selected row carrying the "adjust effort" drill chip.
 */
export default function ModelSliderCatalogList({
  models,
  hasRealModels,
  selectedModelId,
  query,
  drillLabel,
  drillUltra,
  onSelectModel,
  onDrill,
}: {
  models: ModelInfo[];
  hasRealModels: boolean;
  selectedModelId: string | undefined;
  query: string;
  /** Set when the selected model offers a choice of efforts; opens the slider. */
  drillLabel: string | undefined;
  drillUltra: boolean;
  onSelectModel: (modelId: string) => void;
  onDrill: () => void;
}) {
  const rows = hasRealModels ? models : [];
  const selectedIndex = rows.findIndex((model) => model.id === selectedModelId);

  const { scrollRef, virtualizer } = useModelListVirtualizer(rows.length, selectedIndex);

  return (
    <div ref={scrollRef} className="-mx-1 max-h-[200px] min-h-0 overflow-y-auto px-1">
      <div
        role="listbox"
        aria-label="Models"
        className="relative"
        style={{ height: `${String(virtualizer.getTotalSize())}px` }}
      >
        <SelectionHighlight index={selectedIndex} />
        {virtualizer.getVirtualItems().map((item) => {
          const model = rows[item.index];
          const selected = item.index === selectedIndex;
          return (
            <div
              key={model.id}
              className="absolute inset-x-0 top-0"
              style={{ transform: `translateY(${String(item.start)}px)` }}
            >
              <SliderRow
                model={model}
                selected={selected}
                drillLabel={drillLabel}
                drillUltra={drillUltra}
                onSelect={() => {
                  if (!selected) onSelectModel(model.id);
                }}
                onDrill={onDrill}
              />
            </div>
          );
        })}
      </div>
      <ModelListStatus hasRealModels={hasRealModels} empty={models.length === 0} query={query} />
    </div>
  );
}

function SliderRow({
  model,
  selected,
  drillLabel,
  drillUltra,
  onSelect,
  onDrill,
}: {
  model: ModelInfo;
  selected: boolean;
  drillLabel: string | undefined;
  drillUltra: boolean;
  onSelect: () => void;
  onDrill: () => void;
}) {
  return (
    <div
      role="option"
      tabIndex={selected ? 0 : -1}
      aria-selected={selected}
      // A click must not focus the row: the popover walks models from a window
      // keydown, and a focusing click would draw the focus ring on the first arrow.
      onMouseDown={(e) => {
        e.preventDefault();
      }}
      onClick={onSelect}
      onKeyDown={(e) => {
        if (e.key !== 'Enter' && e.key !== ' ') return;
        e.preventDefault();
        onSelect();
      }}
      title={model.displayName}
      className={`relative flex h-10 cursor-pointer items-center gap-2.5 rounded-lg px-2.5 select-none ${
        selected ? 'cursor-default' : 'hover:bg-droid-surface/60'
      }`}
    >
      <span
        className={`flex h-4 w-4 shrink-0 items-center justify-center ${selected ? '' : 'opacity-70'}`}
      >
        <ModelIcon provider={providerOf(model)} size={16} />
      </span>
      {isDroidProxyModel(model) && (
        <span className="shrink-0 flex items-center text-droid-text-muted">
          <DroidProxyMark size={13} />
        </span>
      )}
      <span
        className={`min-w-0 flex-1 truncate text-[14px] font-medium ${
          selected ? 'text-droid-text' : 'text-droid-text-secondary'
        }`}
      >
        {shortModelName(model.displayName)}
      </span>
      {selected && drillLabel !== undefined && (
        <button
          type="button"
          aria-label="Adjust reasoning effort"
          title="Adjust reasoning effort"
          onClick={(e) => {
            e.stopPropagation();
            onDrill();
          }}
          className={`flex h-6 shrink-0 items-center gap-0.5 rounded-md px-1.5 text-[11px] transition-colors hover:bg-droid-bg/60 ${
            drillUltra ? 'text-droid-ultra' : 'text-droid-text-secondary hover:text-droid-text'
          }`}
        >
          {drillLabel}
          <ChevronRight className="h-3 w-3 text-droid-text-muted" />
        </button>
      )}
    </div>
  );
}
