import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { Search } from 'lucide-react';
import type { AgentKind } from '../hooks/persistedUiPreferences';
import {
  childSettingsReadinessLabel,
  type ExactChildSettingsTarget,
} from '../lib/exactChildSettings';
import ModelCatalogList, { effortsFor, stepEffort } from './ModelCatalogList';
import ModelCategoryFilter from './ModelCategoryFilter';
import HarnessRail from '../features/providers/HarnessRail';
import { fitToWindow } from './composer/popoverFit';
import useModelPicker from './useModelPicker';

export type { ExactChildSettingsTarget } from '../lib/exactChildSettings';

const PREFERRED_WIDTH_PX = 420;
// Matches HarnessRail's w-11 column: with the rail the panel widens so the
// catalog keeps its room.
const RAIL_WIDTH_PX = 44;
const MIN_WIDTH_PX = 280;

const accentMix = (pct: number) =>
  `color-mix(in srgb, var(--droid-accent) ${String(pct)}%, transparent)`;

const AGENTS: { kind: AgentKind; label: string; hint: string }[] = [
  { kind: 'primary', label: 'Primary', hint: 'Runs the session' },
  { kind: 'worker', label: 'Worker', hint: 'Executes each feature' },
  { kind: 'validator', label: 'Validator', hint: 'Verifies the work' },
];

export default function ModelSelectorPopover({
  onClose,
  singleAgent = false,
  childTarget,
}: {
  onClose: () => void;
  singleAgent?: boolean;
  childTarget?: ExactChildSettingsTarget;
}) {
  const picker = useModelPicker({ singleAgent, childTarget });
  const {
    agent,
    setAgent,
    selectedAgent,
    query,
    setQuery,
    cat,
    setCat,
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
    source,
    models,
    catCounts,
    hasRealModels,
    showsReasoning,
    defaultModel,
    resolvedModelId,
    selectedLabel,
    activeModel,
    effReasoning,
    updateModel,
    updateReasoning,
  } = picker;
  const ref = useRef<HTMLDivElement>(null);
  const [fit, setFit] = useState<{ width: number; left: number }>();

  const preferredWidth = PREFERRED_WIDTH_PX + (showHarness ? RAIL_WIDTH_PX : 0);

  // The panel grows right from the trigger, which sits well inside the composer,
  // so on a narrow window it would run past the edge. Narrow it to the room
  // there and slide it back, like the composer's other popovers. `left-0`
  // resolves against the trigger's positioning box, so that box is the anchor.
  useLayoutEffect(() => {
    const refit = () => {
      const anchor = ref.current?.offsetParent;
      if (!anchor) return;
      setFit(
        fitToWindow(
          anchor.getBoundingClientRect().left,
          window.innerWidth,
          preferredWidth,
          MIN_WIDTH_PX,
        ),
      );
    };
    refit();
    window.addEventListener('resize', refit);
    return () => {
      window.removeEventListener('resize', refit);
    };
  }, [preferredWidth]);

  const active = AGENTS.find((a) => a.kind === selectedAgent) ?? {
    kind: selectedAgent,
    label: 'Agent',
    hint: '',
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('mousedown', onDown);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('mousedown', onDown);
    };
  }, [onClose]);

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
        const ids: (string | undefined)[] = [undefined, ...models.map((m) => m.id)];
        // Nothing matches the filter: there is nowhere to step, and stepping
        // would silently switch the live setting to Default.
        if (ids.length < 2) return;
        const idx = ids.indexOf(resolvedModelId);
        const down = e.key === 'ArrowDown';
        // A model the filter hides is nowhere in the list: step onto its first
        // or last visible entry instead of off the end into Default.
        const next =
          idx === -1
            ? down
              ? Math.min(1, ids.length - 1)
              : ids.length - 1
            : Math.min(ids.length - 1, Math.max(0, idx + (down ? 1 : -1)));
        if (next !== idx) updateModel(ids[next]);
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
    resolvedModelId,
    effReasoning,
    filterOpen,
    models,
    updateModel,
    updateReasoning,
  ]);

  return (
    <motion.div
      ref={ref}
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 8 }}
      transition={{ duration: 0.16, ease: [0.16, 1, 0.3, 1] }}
      style={fit ?? { width: preferredWidth }}
      className="absolute bottom-full left-0 mb-3 max-w-[calc(100vw-2rem)] z-50"
    >
      <div className="rounded-2xl border border-droid-border bg-droid-elevated shadow-droid overflow-hidden">
        <div className={showHarness ? 'flex' : undefined}>
          {showHarness && (
            <HarnessRail
              current={provider}
              statuses={providerStatuses}
              locked={harnessLocked}
              onSelect={selectHarness}
            />
          )}
          <div className="min-w-0 flex-1">
            {/* Header */}
            <div className="flex items-center justify-between gap-3 px-4 pt-3 pb-2">
              <span className="shrink-0 text-[12px] font-medium text-droid-text-secondary">
                {childTarget ? childTarget.label : singleAgent ? 'Model' : 'Models'}
              </span>
              {childTarget ? (
                <span className="text-[11px] text-droid-text-muted truncate">
                  {childTarget.readiness === 'ready'
                    ? `${active.label} model`
                    : childSettingsReadinessLabel(childTarget.readiness)}
                </span>
              ) : (
                <span
                  className="min-w-0 text-[13px] text-droid-text truncate"
                  title={singleAgent ? 'Used for this chat' : active.hint}
                >
                  {selectedLabel}
                </span>
              )}
            </div>

            {/* Agent tabs */}
            {!singleAgent && !childTarget && (
              <div className="px-3">
                <div className="flex gap-1 p-0.5 rounded-xl bg-droid-bg/60 border border-droid-border">
                  {AGENTS.map((a) => {
                    const on = a.kind === agent;
                    return (
                      <button
                        key={a.kind}
                        onClick={() => {
                          setAgent(a.kind);
                        }}
                        className={`flex-1 px-2 py-1.5 rounded-lg text-[11px] font-medium transition-colors truncate ${
                          on
                            ? 'bg-droid-surface text-droid-text'
                            : 'text-droid-text-muted hover:text-droid-text-secondary'
                        }`}
                        style={on ? { boxShadow: `inset 0 0 0 1px ${accentMix(33)}` } : undefined}
                      >
                        {a.label}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Model search + list */}
            <div className="px-4 pt-3 pb-3">
              <div className="flex items-center gap-2 px-3 h-9 rounded-lg bg-droid-bg/60 border border-droid-border focus-within:border-droid-border-hover transition-colors">
                <Search className="w-3.5 h-3.5 text-droid-text-muted shrink-0" />
                <input
                  autoFocus
                  value={query}
                  onChange={(e) => {
                    setQuery(e.target.value);
                  }}
                  placeholder="Search models"
                  className="min-w-0 flex-1 bg-transparent text-[13px] text-droid-text placeholder-droid-text-muted focus:outline-none"
                />

                <ModelCategoryFilter
                  cat={cat}
                  total={source.length}
                  counts={catCounts}
                  open={filterOpen}
                  onOpenChange={setFilterOpen}
                  onSelect={setCat}
                />
              </div>

              <ModelCatalogList
                models={models}
                defaultModel={defaultModel}
                hasRealModels={hasRealModels}
                provider={provider}
                selectedModelId={resolvedModelId}
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

      {/* Tail */}
      <div className="absolute -bottom-1.5 left-7 w-3 h-3 rotate-45 bg-droid-elevated border-r border-b border-droid-border" />
    </motion.div>
  );
}
