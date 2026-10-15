import { useEffect } from 'react';
import { Search } from 'lucide-react';
import { Input } from './ui/Field';
import type { AgentKind } from '../hooks/persistedUiPreferences';
import {
  childSettingsReadinessLabel,
  type ExactChildSettingsTarget,
} from '../lib/exactChildSettings';
import ModelCatalogList, { effortsFor, stepEffort, stepModel } from './ModelCatalogList';
import ModelCategoryFilter from './ModelCategoryFilter';
import HarnessRail from '../features/providers/HarnessRail';
import useModelPicker from './useModelPicker';

export type { ExactChildSettingsTarget } from '../lib/exactChildSettings';

const WIDTH_PX = 380;
// Matches HarnessRail's w-11 column: with the rail the panel widens so the
// catalog keeps its room.
const RAIL_WIDTH_PX = 44;
// Inside the window's 8px floating-layer margin on both sides.
const MAX_WIDTH = 'calc(100vw - 16px)';

const AGENTS: { kind: AgentKind; label: string; hint: string }[] = [
  { kind: 'primary', label: 'Primary', hint: 'Runs the session' },
  { kind: 'worker', label: 'Worker', hint: 'Executes each feature' },
  { kind: 'validator', label: 'Validator', hint: 'Verifies the work' },
];

// The classic model picker's panel; the composer floats it above the model chip.
export default function ModelSelectorPopover({
  appSessionId,
  singleAgent = false,
  childTarget,
}: {
  appSessionId: string | null;
  singleAgent?: boolean;
  childTarget?: ExactChildSettingsTarget;
}) {
  const picker = useModelPicker({ appSessionId, singleAgent, childTarget });
  const {
    agent,
    setAgent,
    selectedAgent,
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
    harnessLocked,
    selectHarness,
    childMode,
    childReady,
    disabled,
    models,
    hasRealModels,
    showsReasoning,
    selectedRowId,
    selectedLabel,
    activeModel,
    effReasoning,
    updateModel,
    updateReasoning,
  } = picker;
  const width = WIDTH_PX + (showHarness ? RAIL_WIDTH_PX : 0);

  const active = AGENTS.find((a) => a.kind === selectedAgent) ?? {
    kind: selectedAgent,
    label: 'Agent',
    hint: '',
  };

  // Arrow keys: ↑/↓ walk the filtered list, ←/→ step the selected model's effort.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!e.key.startsWith('Arrow') || filterOpen) return;
      // Leave ←/→ to the search caret while there is text to move through.
      const inSearch = e.target instanceof HTMLInputElement && e.target.value.length > 0;
      const horizontal = e.key === 'ArrowLeft' || e.key === 'ArrowRight';
      if (inSearch && horizontal) return;
      e.preventDefault();
      if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
        if (childTarget && !childReady) return;
        const next = stepModel(models, selectedRowId, e.key === 'ArrowDown');
        if (next) updateModel(next);
        return;
      }
      const efforts = effortsFor(activeModel, effReasoning);
      const next = stepEffort(efforts, effReasoning, e.key === 'ArrowRight' ? 1 : -1);
      if (next !== undefined && next !== effReasoning) updateReasoning(next);
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
    };
  }, [
    activeModel,
    childReady,
    childTarget,
    selectedRowId,
    effReasoning,
    filterOpen,
    models,
    updateModel,
    updateReasoning,
  ]);

  return (
    <div style={{ width, maxWidth: MAX_WIDTH }} className="flex min-h-0 flex-1 flex-col">
      <div className="flex min-h-0 flex-1">
        {showHarness && (
          <HarnessRail
            current={provider}
            statuses={providerStatuses}
            locked={harnessLocked}
            onSelect={selectHarness}
          />
        )}
        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
          {/* Header */}
          <div className="flex items-center justify-between gap-3 px-3 pt-3 pb-1">
            <span className="shrink-0 text-label text-secondary">
              {childTarget ? childTarget.label : singleAgent ? 'Model' : 'Models'}
            </span>
            {childTarget ? (
              <span className="truncate text-caption text-muted">
                {childTarget.readiness === 'ready'
                  ? `${active.label} model`
                  : childSettingsReadinessLabel(childTarget.readiness)}
              </span>
            ) : (
              <span
                className="min-w-0 truncate text-body text-primary"
                title={singleAgent ? 'Used for this chat' : active.hint}
              >
                {selectedLabel}
              </span>
            )}
          </div>

          {/* Agent tabs */}
          {!singleAgent && !childTarget && (
            <div className="px-3">
              <div className="flex gap-1 rounded-lg bg-bg/60 p-0.5">
                {AGENTS.map((a) => {
                  const on = a.kind === agent;
                  return (
                    <button
                      key={a.kind}
                      onClick={() => {
                        setAgent(a.kind);
                      }}
                      className={`flex-1 truncate rounded-md px-2 py-1.5 text-label transition-colors ${
                        on ? 'bg-raised text-primary' : 'text-muted hover:text-secondary'
                      }`}
                    >
                      {a.label}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {/* Model search + list */}
          <div className="flex min-h-0 flex-col px-2 pt-2 pb-2">
            <div className="flex shrink-0 items-center gap-1.5">
              <div className="flex h-control-md min-w-0 flex-1 items-center gap-2 rounded-md bg-bg/50 px-3">
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

            <ModelCatalogList
              models={models}
              hasRealModels={hasRealModels}
              provider={provider}
              selectedModelId={selectedRowId}
              reasoning={effReasoning}
              query={query}
              onSelectModel={updateModel}
              onSelectReasoning={updateReasoning}
              disabled={disabled}
              reasoningLocked={childMode}
              showReasoning={showsReasoning}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
