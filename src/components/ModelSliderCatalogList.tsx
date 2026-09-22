import { ChevronRight } from 'lucide-react';
import type { ModelInfo } from '../types/bridge';
import { ModelIcon, providerOf } from './ModelIcon';
import { ModelListStatus, SelectionHighlight, useModelListVirtualizer } from './modelListParts';

/**
 * The slider popover's model list: a virtualized Default row plus the filtered
 * catalog, with the selected row carrying the "adjust effort" drill chip.
 */
export default function ModelSliderCatalogList({
  models,
  defaultModel,
  hasRealModels,
  selectedModelId,
  query,
  drillLabel,
  drillUltra,
  onSelectModel,
  onDrill,
}: {
  models: ModelInfo[];
  defaultModel: ModelInfo | undefined;
  hasRealModels: boolean;
  selectedModelId: string | undefined;
  query: string;
  /** Set when the selected model offers a choice of efforts; opens the slider. */
  drillLabel: string | undefined;
  drillUltra: boolean;
  onSelectModel: (modelId?: string) => void;
  onDrill: () => void;
}) {
  const rows = hasRealModels ? models : [];
  const selectedIndex = selectedModelId
    ? (() => {
        const index = rows.findIndex((model) => model.id === selectedModelId);
        return index < 0 ? -1 : index + 1;
      })()
    : 0;

  const { scrollRef, virtualizer } = useModelListVirtualizer(rows.length + 1, selectedIndex);

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
          const isDefaultRow = item.index === 0;
          const model = isDefaultRow ? defaultModel : rows[item.index - 1];
          return (
            <div
              key={isDefaultRow ? 'default' : (model?.id ?? item.index)}
              className="absolute inset-x-0 top-0"
              style={{ transform: `translateY(${String(item.start)}px)` }}
            >
              <SliderRow
                model={model}
                label={rowLabel(isDefaultRow, defaultModel, model)}
                selected={item.index === selectedIndex}
                drillLabel={drillLabel}
                drillUltra={drillUltra}
                onSelect={() => {
                  onSelectModel(isDefaultRow ? undefined : model?.id);
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

function rowLabel(
  isDefaultRow: boolean,
  defaultModel: ModelInfo | undefined,
  model: ModelInfo | undefined,
): string {
  if (!isDefaultRow) return model?.displayName ?? '';
  return defaultModel ? `Default · ${defaultModel.displayName}` : 'Default';
}

function SliderRow({
  model,
  label,
  selected,
  drillLabel,
  drillUltra,
  onSelect,
  onDrill,
}: {
  model: ModelInfo | undefined;
  label: string;
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
      title={label}
      className={`relative flex h-10 cursor-pointer items-center gap-2.5 rounded-lg px-2.5 select-none ${
        selected ? 'cursor-default' : 'hover:bg-droid-surface/60'
      }`}
    >
      <span
        className={`flex h-4 w-4 shrink-0 items-center justify-center ${selected ? '' : 'opacity-70'}`}
      >
        <ModelIcon provider={providerOf(model)} size={16} />
      </span>
      <span
        className={`min-w-0 flex-1 truncate text-[14px] font-medium ${
          selected ? 'text-droid-text' : 'text-droid-text-secondary'
        }`}
      >
        {label}
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
