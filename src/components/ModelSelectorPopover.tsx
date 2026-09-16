import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Search, Check, SlidersHorizontal } from 'lucide-react';
import { shallowEqual, useStoreDispatch, useStoreSelector } from '../hooks/useStore';
import type { AgentKind } from '../hooks/persistedUiPreferences';
import type { ReasoningEffort, ModelInfo } from '../types/bridge';
import { reasoningForModelSwitch } from '../lib/reasoningEffort';
import {
  updateAgentSettings,
  updateChildSettings,
  updateSessionSettings,
  listModels,
} from '../lib/commands';
import {
  childSettingsReadinessLabel,
  planChildModelUpdate,
  type ExactChildSettingsTarget,
} from '../lib/exactChildSettings';
import { effectiveProvider } from '../features/providers/providerDraft';
import {
  providerDefaultModel,
  providerModelCatalog,
  providerModelSelection,
} from '../features/providers/providerIdentity';
import ModelCatalogList, { defaultModelOf, effortsFor, stepEffort } from './ModelCatalogList';

export type { ExactChildSettingsTarget } from '../lib/exactChildSettings';

const ACCENT = 'var(--droid-accent)';
const accentMix = (pct: number) =>
  `color-mix(in srgb, var(--droid-accent) ${String(pct)}%, transparent)`;

type ModelCategory = 'core' | 'factory' | 'claude' | 'custom';

const CATEGORY_LABEL: Record<ModelCategory, string> = {
  core: 'Droid core',
  factory: 'Factory',
  claude: 'Claude',
  custom: 'Custom',
};

function categoryOf(model: ModelInfo): ModelCategory {
  if (model.isCustom || model.id.startsWith('custom:')) return 'custom';
  const provider = (model.provider ?? '').toLowerCase();
  if (provider === 'anthropic') return 'claude';
  if (provider === 'droid-core' || model.displayName.toLowerCase().startsWith('droid core'))
    return 'core';
  return 'factory';
}

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
  const dispatch = useStoreDispatch();
  const state = useStoreSelector((current) => {
    const activeSession = current.activeAppSessionId
      ? current.sessions[current.activeAppSessionId]
      : undefined;
    return {
      activeSessionAppSessionId: activeSession?.appSessionId,
      activeSessionModelId: activeSession?.modelId,
      activeSessionReasoning: activeSession?.reasoningEffort,
      agentConfig: current.agentConfig,
      // The chat's provider owns the catalog: Droid's comes from the CLI,
      // every other provider reports its own with its status. A draft follows
      // the same fallback the composer applies to an unrunnable stored pick.
      provider:
        activeSession?.provider ??
        effectiveProvider(current.draftProvider, current.providerStatuses),
      providerStatuses: current.providerStatuses,
      models: current.models,
    };
  }, shallowEqual);
  const [agent, setAgent] = useState<AgentKind>('primary');
  const [query, setQuery] = useState('');
  const [cat, setCat] = useState<ModelCategory | 'all'>('all');
  const [filterOpen, setFilterOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const filterRef = useRef<HTMLDivElement>(null);
  const childMode = childTarget !== undefined;

  const selectedAgent = childTarget?.role ?? agent;
  const active = AGENTS.find((a) => a.kind === selectedAgent) ?? {
    kind: selectedAgent,
    label: 'Agent',
    hint: '',
  };
  const cfg = state.agentConfig[selectedAgent];

  // For a single chat, the model/reasoning belong to that session, not the global default.
  const scopedAppSessionId = singleAgent ? state.activeSessionAppSessionId : undefined;
  let effModelId = cfg.modelId;
  let effReasoning: ReasoningEffort | undefined = cfg.reasoning;
  if (scopedAppSessionId) {
    effModelId = state.activeSessionModelId;
    effReasoning = state.activeSessionReasoning;
  }
  if (childTarget) {
    effModelId = childTarget.modelId;
    effReasoning = childTarget.reasoningEffort;
  }
  const childReady = childTarget?.readiness === 'ready';

  const source = providerModelCatalog(state.provider, state.models, state.providerStatuses);
  const hasRealModels = source.length > 0;
  // A provider that publishes no reasoning efforts has nothing to offer per row:
  // the stepper would be inert and the word beside it a Droid effort. A ready
  // provider whose catalog has not arrived has not answered yet, so the control
  // stays; one that cannot run has no efforts to offer at all.
  const status = state.providerStatuses.find((entry) => entry.provider === state.provider);
  const catalogPending = !status || (status.readiness === 'ready' && !hasRealModels);
  const showsReasoning =
    catalogPending ||
    source.some(
      (model) =>
        (model.supportedReasoningEfforts?.length ?? 0) > 0 ||
        model.defaultReasoningEffort !== undefined,
    );
  const needsDroidCatalog = state.provider === 'droid' && !hasRealModels;

  // The catalog is Droid CLI's source of truth; if it hasn't arrived yet, fetch it.
  useEffect(() => {
    if (needsDroidCatalog) listModels();
  }, [needsDroidCatalog]);

  const catCounts = useMemo(() => {
    const counts: Record<ModelCategory, number> = { core: 0, factory: 0, claude: 0, custom: 0 };
    source.forEach((m) => {
      counts[categoryOf(m)] += 1;
    });
    return counts;
  }, [source]);

  const models = useMemo(() => {
    const q = query.trim().toLowerCase();
    return source.filter((m) => {
      if (cat !== 'all' && categoryOf(m) !== cat) return false;
      if (!q) return true;
      return m.displayName.toLowerCase().includes(q) || m.id.toLowerCase().includes(q);
    });
  }, [source, query, cat]);

  const selectCat = (next: ModelCategory | 'all') => {
    setCat(next);
    setFilterOpen(false);
  };

  useEffect(() => {
    if (!filterOpen) return;
    const onDown = (e: MouseEvent) => {
      if (filterRef.current && !filterRef.current.contains(e.target as Node)) setFilterOpen(false);
    };
    window.addEventListener('mousedown', onDown);
    return () => {
      window.removeEventListener('mousedown', onDown);
    };
  }, [filterOpen]);

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

  // The row a chat with no model of its own runs on: the default its harness
  // reports, and the catalog's own default row only where none is reported.
  const defaultModel = useMemo(
    () =>
      providerDefaultModel(state.provider, source, state.providerStatuses) ??
      defaultModelOf(source),
    [state.provider, state.providerStatuses, source],
  );
  // Saved ids remain authoritative even while the catalog omits their row.
  const resolvedModelId =
    childTarget || scopedAppSessionId
      ? effModelId
      : providerModelSelection(state.provider, effModelId, source);
  const selectedLabel = resolvedModelId
    ? (source.find((model) => model.id === resolvedModelId)?.displayName ?? resolvedModelId)
    : (defaultModel?.displayName ?? 'Default');
  const activeModel = resolvedModelId ? source.find((x) => x.id === resolvedModelId) : defaultModel;

  const updateReasoning = useCallback(
    (reasoning: ReasoningEffort) => {
      if (childTarget) return;
      if (scopedAppSessionId) {
        updateSessionSettings({ appSessionId: scopedAppSessionId, reasoningEffort: reasoning });
        return;
      }
      dispatch({ type: 'SET_AGENT_REASONING', agent, reasoning });
      updateAgentSettings({
        appSessionId: state.activeSessionAppSessionId,
        agent,
        reasoningEffort: reasoning,
      });
    },
    [agent, childTarget, dispatch, scopedAppSessionId, state.activeSessionAppSessionId],
  );

  const updateModel = useCallback(
    (modelId?: string) => {
      if (childTarget) {
        const update = planChildModelUpdate(childTarget, modelId, effReasoning, source);
        if (update) updateChildSettings(update);
        return;
      }

      // Snap only an explicit effort, as part of the same user-requested update.
      const next = modelId ? source.find((x) => x.id === modelId) : defaultModel;
      const reasoningEffort = reasoningForModelSwitch(next, effReasoning);
      const settings = {
        modelId: modelId ?? null,
        ...(reasoningEffort === undefined ? {} : { reasoningEffort }),
      };
      if (scopedAppSessionId) {
        updateSessionSettings({ appSessionId: scopedAppSessionId, ...settings });
        return;
      }
      dispatch({ type: 'SET_AGENT_MODEL', agent, modelId });
      if (reasoningEffort !== undefined)
        dispatch({
          type: 'SET_AGENT_REASONING',
          agent,
          reasoning: reasoningEffort ?? undefined,
        });
      updateAgentSettings({ appSessionId: state.activeSessionAppSessionId, agent, ...settings });
    },
    [
      agent,
      childTarget,
      defaultModel,
      dispatch,
      effReasoning,
      scopedAppSessionId,
      source,
      state.activeSessionAppSessionId,
    ],
  );

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
      className="absolute bottom-full left-0 mb-3 w-[min(420px,calc(100vw-2rem))] z-50"
    >
      <div className="rounded-2xl border border-droid-border bg-droid-elevated shadow-droid overflow-hidden">
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
          <div className="flex items-center gap-2">
            <div className="flex flex-1 items-center gap-2 px-3 h-9 rounded-lg bg-droid-bg/60 border border-droid-border focus-within:border-droid-border-hover transition-colors">
              <Search className="w-3.5 h-3.5 text-droid-text-muted shrink-0" />
              <input
                autoFocus
                value={query}
                onChange={(e) => {
                  setQuery(e.target.value);
                }}
                placeholder="Search models"
                className="flex-1 bg-transparent text-[12px] text-droid-text placeholder-droid-text-muted focus:outline-none"
              />
            </div>

            <div className="relative shrink-0" ref={filterRef}>
              <button
                onClick={() => {
                  setFilterOpen((v) => !v);
                }}
                title="Filter models by category"
                className={`flex items-center justify-center w-9 h-9 rounded-lg border transition-colors ${
                  filterOpen || cat !== 'all'
                    ? 'text-droid-text border-transparent'
                    : 'text-droid-text-muted border-droid-border hover:text-droid-text hover:border-droid-border-hover bg-droid-bg/60'
                }`}
                style={
                  filterOpen || cat !== 'all'
                    ? {
                        backgroundColor: accentMix(13),
                        boxShadow: `inset 0 0 0 1px ${accentMix(40)}`,
                      }
                    : undefined
                }
              >
                <SlidersHorizontal className="w-3.5 h-3.5" />
              </button>

              <AnimatePresence>
                {filterOpen && (
                  <motion.div
                    initial={{ opacity: 0, y: 6 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: 6 }}
                    transition={{ duration: 0.14, ease: [0.16, 1, 0.3, 1] }}
                    className="absolute right-0 top-full mt-1.5 w-44 z-50 rounded-xl border border-droid-border bg-droid-elevated shadow-md overflow-hidden p-1"
                  >
                    {[
                      { value: 'all' as const, label: 'All models', count: source.length },
                      { value: 'core' as const, label: CATEGORY_LABEL.core, count: catCounts.core },
                      {
                        value: 'factory' as const,
                        label: CATEGORY_LABEL.factory,
                        count: catCounts.factory,
                      },
                      {
                        value: 'claude' as const,
                        label: CATEGORY_LABEL.claude,
                        count: catCounts.claude,
                      },
                      {
                        value: 'custom' as const,
                        label: CATEGORY_LABEL.custom,
                        count: catCounts.custom,
                      },
                    ].map((opt) => {
                      const on = cat === opt.value;
                      return (
                        <button
                          key={opt.value}
                          onClick={() => {
                            selectCat(opt.value);
                          }}
                          className={`w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-left text-[12px] transition-colors ${
                            on
                              ? 'bg-droid-surface text-droid-text'
                              : 'text-droid-text-secondary hover:bg-droid-surface/60'
                          }`}
                        >
                          <span className="w-3.5 h-3.5 shrink-0 flex items-center justify-center">
                            {on && (
                              <Check
                                className="w-3 h-3"
                                style={{ color: ACCENT }}
                                strokeWidth={3.5}
                              />
                            )}
                          </span>
                          <span className="flex-1">{opt.label}</span>
                          <span className="text-[11px] text-droid-text-muted">{opt.count}</span>
                        </button>
                      );
                    })}
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </div>

          <ModelCatalogList
            models={models}
            defaultModel={defaultModel}
            hasRealModels={hasRealModels}
            provider={state.provider}
            selectedModelId={resolvedModelId}
            reasoning={effReasoning}
            query={query}
            onSelectModel={updateModel}
            onSelectReasoning={updateReasoning}
            disabled={Boolean(childTarget && !childReady)}
            reasoningLocked={childMode}
            showReasoning={showsReasoning}
          />
        </div>
      </div>

      {/* Tail */}
      <div className="absolute -bottom-1.5 left-7 w-3 h-3 rotate-45 bg-droid-elevated border-r border-b border-droid-border" />
    </motion.div>
  );
}
