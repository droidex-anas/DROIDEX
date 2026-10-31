import { useEffect } from 'react';
import { Search } from 'lucide-react';
import HarnessSegments from '../features/providers/HarnessSegments';
import ChatModelList from './ChatModelList';
import ModelCategoryFilter from './ModelCategoryFilter';
import { stepModel } from './ModelCatalogList';
import useModelPicker from './useModelPicker';
import { Input } from './ui/Field';

const WIDTH_PX = 320;
// Inside the window's 8px floating-layer margin on both sides.
const MAX_WIDTH = 'calc(100vw - 16px)';

/**
 * The composer's model picker for one chat: the harness while the chat is new,
 * then that harness's models. Effort has its own chip beside the model chip;
 * Mission Control and exact-child editors keep ModelSelectorPopover.
 */
export default function ChatModelPopover({ appSessionId }: { appSessionId: string | null }) {
  const {
    query,
    setQuery,
    cat,
    setCat,
    catOptions,
    filterOpen,
    setFilterOpen,
    provider,
    providerStatuses,
    showHarness,
    selectHarness,
    models,
    hasRealModels,
    selectedRowId,
    updateModel,
  } = useModelPicker({ appSessionId, singleAgent: true });

  // ↑/↓ walk the filtered list from the search field.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (filterOpen || (e.key !== 'ArrowUp' && e.key !== 'ArrowDown')) return;
      e.preventDefault();
      const next = stepModel(models, selectedRowId, e.key === 'ArrowDown');
      if (next) updateModel(next);
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
    };
  }, [filterOpen, models, selectedRowId, updateModel]);

  return (
    <div
      style={{ width: WIDTH_PX, maxWidth: MAX_WIDTH }}
      className="flex min-h-0 flex-1 flex-col gap-1.5 p-1.5"
    >
      {showHarness && (
        <HarnessSegments provider={provider} statuses={providerStatuses} onSelect={selectHarness} />
      )}
      <div className="flex shrink-0 items-center gap-1.5">
        <div className="flex h-control-md min-w-0 flex-1 items-center gap-2 rounded-md bg-field px-2 dark:bg-bg/50">
          <Search className="size-icon-sm shrink-0 text-muted" />
          <Input
            variant="embedded"
            autoFocus
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
            }}
            placeholder="Search models"
            aria-label="Search models"
          />
        </div>
        {catOptions.length > 0 && (
          <ModelCategoryFilter
            options={catOptions}
            selected={cat}
            open={filterOpen}
            onOpenChange={setFilterOpen}
            onSelect={setCat}
          />
        )}
      </div>
      <div className="px-2 pt-1 text-caption text-muted">Select model</div>
      <ChatModelList
        models={models}
        hasRealModels={hasRealModels}
        selectedModelId={selectedRowId}
        query={query}
        onSelectModel={updateModel}
      />
    </div>
  );
}
