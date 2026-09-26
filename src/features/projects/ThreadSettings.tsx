import { useMemo, useRef, useState } from 'react';
import { ChevronDown, Search } from '@droidex/icons';
import ModelCatalogList from '../../components/ModelCatalogList';
import { Popover } from '../../components/environment/Popover';
import { ModelIcon, providerOf } from '../../components/ModelIcon';
import AutonomySelector from '../../components/AutonomySelector';
import { reasoningEffortLabel } from '../../lib/reasoningEffort';
import HarnessSegments from '../providers/HarnessSegments';
import type { ProviderStatus } from '../../types/bridge';
import type { ThreadCatalog, ThreadSelection } from './useThreadSelection';

/* What a project's lead will run with: the app's own catalog list in the app's
   own popover, with the same harness segments, rows, search and effort levels
   the composer offers, because a second, native picker would neither match the
   app nor show a harness's real catalog. The harness sits above the models it
   decides, as it does in the composer. */

export function ThreadSettings({
  value,
  catalog,
  statuses,
  disabled,
  onChange,
}: {
  value: ThreadSelection;
  catalog: ThreadCatalog;
  statuses: ProviderStatus[];
  disabled: boolean;
  onChange: (selection: ThreadSelection) => void;
}) {
  const [modelOpen, setModelOpen] = useState(false);
  const [query, setQuery] = useState('');
  const modelRef = useRef<HTMLButtonElement>(null);
  // The list is what the search narrows: ModelCatalogList renders the rows it is
  // given and only uses the query to say when none matched.
  const models = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    if (!normalized) return catalog.models;
    return catalog.models.filter(
      (model) =>
        model.displayName.toLowerCase().includes(normalized) ||
        model.id.toLowerCase().includes(normalized) ||
        (model.provider ?? '').toLowerCase().includes(normalized),
    );
  }, [catalog.models, query]);
  const selected = catalog.models.find((model) => model.id === value.modelId);
  const shown = selected ?? catalog.defaultModel;
  const effort = value.reasoning ?? shown?.defaultReasoningEffort;

  return (
    <div className="flex min-w-0 items-center gap-1.5">
      <button
        ref={modelRef}
        type="button"
        disabled={disabled}
        aria-expanded={modelOpen}
        onClick={() => {
          setModelOpen((open) => !open);
        }}
        className="flex min-w-0 items-center gap-1.5 rounded-lg px-2 py-1 text-[12px] text-droid-text-secondary transition-colors hover:bg-droid-elevated disabled:opacity-40"
      >
        <ModelIcon provider={providerOf(shown, value.modelId)} size={14} />
        <span className="max-w-[150px] truncate">{shown?.displayName ?? 'Default model'}</span>
        {effort && (
          <span className="shrink-0 text-droid-text-muted">
            {reasoningEffortLabel(effort, value.provider)}
          </span>
        )}
        <ChevronDown className="h-3 w-3 shrink-0 text-droid-text-muted" />
      </button>
      <Popover
        open={modelOpen}
        onClose={() => {
          setModelOpen(false);
          setQuery('');
        }}
        anchorRef={modelRef}
        align="left"
        width={320}
        label="Choose a model"
      >
        <HarnessSegments
          provider={value.provider}
          statuses={statuses}
          locked={disabled}
          onSelect={(provider) => {
            onChange({ ...value, provider, modelId: '', reasoning: undefined });
          }}
        />
        <div className="px-3 pb-2 pt-3">
          <div className="flex h-9 items-center gap-2 rounded-lg border border-droid-border bg-droid-bg/60 px-3 transition-colors focus-within:border-droid-border-hover">
            <Search className="h-3.5 w-3.5 shrink-0 text-droid-text-muted" />
            <input
              autoFocus
              value={query}
              onChange={(event) => {
                setQuery(event.target.value);
              }}
              placeholder="Search models"
              className="flex-1 bg-transparent text-[12px] text-droid-text placeholder-droid-text-muted focus:outline-none"
            />
          </div>
        </div>
        <ModelCatalogList
          models={models}
          hasRealModels={catalog.models.length > 0}
          provider={value.provider}
          selectedModelId={value.modelId || undefined}
          reasoning={value.reasoning}
          query={query}
          disabled={disabled}
          reasoningLocked={false}
          showReasoning={catalog.efforts.length > 0}
          onSelectModel={(modelId) => {
            onChange({ ...value, modelId, reasoning: undefined });
            setModelOpen(false);
            setQuery('');
          }}
          onSelectReasoning={(reasoning) => {
            onChange({ ...value, reasoning });
          }}
        />
      </Popover>
      <AutonomySelector
        scope="draft"
        value={value.autonomy}
        disabled={disabled}
        onSelect={(autonomy) => {
          onChange({ ...value, autonomy });
        }}
        placement="down"
      />
    </div>
  );
}
