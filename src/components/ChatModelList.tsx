import type { ModelInfo } from '@droidex/protocol';
import {
  ModelIcon,
  DroidProxyMark,
  isDroidProxyModel,
  providerOf,
  shortModelName,
} from './ModelIcon';
import { ModelListStatus } from './modelListParts';
import VirtualModelListbox from './VirtualModelListbox';

/** The chat model picker's list: the virtualized, filtered catalog. */
export default function ChatModelList({
  models,
  hasRealModels,
  selectedModelId,
  query,
  onSelectModel,
}: {
  models: ModelInfo[];
  hasRealModels: boolean;
  selectedModelId: string | undefined;
  query: string;
  onSelectModel: (modelId: string) => void;
}) {
  const rows = hasRealModels ? models : [];
  const selectedIndex = rows.findIndex((model) => model.id === selectedModelId);

  return (
    <VirtualModelListbox
      rows={rows}
      selectedIndex={selectedIndex}
      renderRow={(model, selected) => (
        <ModelRow
          model={model}
          selected={selected}
          onSelect={() => {
            if (!selected) onSelectModel(model.id);
          }}
        />
      )}
    >
      <ModelListStatus hasRealModels={hasRealModels} empty={models.length === 0} query={query} />
    </VirtualModelListbox>
  );
}

function ModelRow({
  model,
  selected,
  onSelect,
}: {
  model: ModelInfo;
  selected: boolean;
  onSelect: () => void;
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
      className={`relative flex h-10 cursor-pointer items-center gap-2.5 rounded-md px-2 select-none ${
        selected ? 'cursor-default' : 'hover:bg-elevated dark:hover:bg-active'
      }`}
    >
      <span
        className={`flex h-4 w-4 shrink-0 items-center justify-center ${selected ? '' : 'opacity-70'}`}
      >
        <ModelIcon provider={providerOf(model)} size={16} />
      </span>
      {isDroidProxyModel(model) && (
        <span className="shrink-0 flex items-center">
          <DroidProxyMark size={13} />
        </span>
      )}
      <span
        className={`min-w-0 flex-1 truncate text-body-strong ${
          selected ? 'text-primary' : 'text-secondary'
        }`}
      >
        {shortModelName(model.displayName)}
      </span>
    </div>
  );
}
