import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { ChevronLeft, RotateCcw, Search } from 'lucide-react';
import { Zap } from '@droidex/icons';
import type { ProviderKind, ReasoningEffort } from '../types/bridge';
import {
  isReasoningEffort,
  offersReasoningEffort,
  reasoningEffortLabel,
} from '../lib/reasoningEffort';
import {
  FAST_MODE_HINT,
  FAST_MODE_LABEL,
  fastModeBlockedReason,
  offersFastMode,
} from '../lib/fastMode';
import { contextWindowOptions, offersContextWindow } from '../lib/contextWindow';
import useContextWindow from '../hooks/useContextWindow';
import {
  ModelIcon,
  DroidProxyMark,
  isDroidProxyModel,
  providerOf,
  shortModelName,
} from './ModelIcon';
import HarnessSegments from '../features/providers/HarnessSegments';
import ModelCategoryFilter from './ModelCategoryFilter';
import { effortsFor, stepModel } from './ModelCatalogList';
import useModelPicker from './useModelPicker';
import ModelSliderCatalogList from './ModelSliderCatalogList';
import ContextWindowMenu from './ContextWindowMenu';
import { pushEscapeLayer } from './ui/escapeStack';
import { Tooltip } from './ui/Tooltip';
import EffortSlider from './effortSlider/EffortSlider';
import type { EffortSliderElement, EffortSliderLevel } from './effortSlider/effortSliderElement';

const WIDTH_PX = 320;
// Inside the window's 8px floating-layer margin on both sides.
const MAX_WIDTH = 'calc(100vw - 16px)';

// The slider speaks the chip's vocabulary (Xhigh, and the harness's own word
// for ultra: Ultracode on Claude, Ultra elsewhere).
function effortDisplay(effort: ReasoningEffort, provider: ProviderKind): string {
  const label = reasoningEffortLabel(effort, provider);
  return label.charAt(0).toUpperCase() + label.slice(1);
}

// The card is already the surface, so the slider's own panel stays flat and
// fills the card at the app's type scale instead of scaling with its width.
const SLIDER_STYLE = {
  '--effort-unit': '1px',
  '--effort-width': '100%',
  '--effort-padding': '8px 4px 4px',
  '--effort-surface': 'transparent',
  '--effort-border': 'transparent',
  '--effort-shadow': 'none',
  '--effort-text': 'var(--text)',
  '--effort-muted': 'var(--text-muted)',
  '--effort-fill': 'color-mix(in srgb, var(--text) 45%, transparent)',
  '--effort-accent': 'var(--ultra, #a392e5)',
} as CSSProperties;

/**
 * The alternative composer model selector: a panel that lists models and
 * drills into a spring effort slider for the selected one. Scoped to a single
 * chat; Mission Control and exact-child pickers keep the classic popover. The
 * composer floats it above the model chip.
 */
export default function ModelSliderPopover({ appSessionId }: { appSessionId: string | null }) {
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
    harnessLocked,
    selectHarness,
    models,
    hasRealModels,
    showsReasoning,
    resolvedModelId,
    selectedRowId,
    selectedLabel,
    activeModel,
    effReasoning,
    fastMode,
    setFastMode,
    scopedAppSessionId,
    updateModel,
    updateReasoning,
  } = useModelPicker({ appSessionId, singleAgent: true });
  const { contextWindowTokens, providerWindow, setContextWindow } =
    useContextWindow(scopedAppSessionId);
  const efforts = effortsFor(activeModel, effReasoning);
  const canDrill =
    activeModel !== undefined &&
    showsReasoning &&
    offersReasoningEffort(activeModel) &&
    efforts.length > 1;
  // Reopening the chip is usually about effort; the back button reaches the list.
  const [view, setView] = useState<'list' | 'effort'>(canDrill ? 'effort' : 'list');
  const panelRef = useRef<HTMLDivElement>(null);
  const sliderRef = useRef<EffortSliderElement>(null);

  const levels = useMemo<EffortSliderLevel[]>(
    () => efforts.map((effort) => ({ value: effort, label: effortDisplay(effort, provider) })),
    [efforts, provider],
  );
  // An unset effort is provider-managed; the slider sits on the model's default.
  const shownEffort = effReasoning ?? activeModel?.defaultReasoningEffort;
  const sliderValue =
    shownEffort !== undefined && levels.some((level) => level.value === shownEffort)
      ? shownEffort
      : (levels.at(-1)?.value ?? '');
  const showEffortView = view === 'effort' && canDrill && sliderValue !== '';
  const drillLabel = !canDrill
    ? undefined
    : shownEffort === undefined
      ? 'Default'
      : effortDisplay(shownEffort, provider);

  const fastModeBlocked = fastModeBlockedReason(activeModel);
  // The window a chat that pins none runs on: the one measured for it, or for
  // a draft on the harness's own default model, the one that default asks for.
  const status = providerStatuses.find((entry) => entry.provider === provider);
  const defaultWindow =
    providerWindow ??
    (activeModel?.id === status?.defaultModelId ? status?.defaultContextWindowTokens : undefined);
  const defaultEffort = activeModel?.defaultReasoningEffort;
  const canReset =
    defaultEffort !== undefined &&
    defaultEffort !== sliderValue &&
    levels.some((level) => level.value === defaultEffort);

  // A pick keeps the slider open: releasing the thumb is not a request to leave.
  const commitEffort = (value: string) => {
    if (isReasoningEffort(value)) updateReasoning(value);
  };

  // Escape backs out of the effort view before it closes the panel.
  useEffect(() => {
    if (!showEffortView) return;
    return pushEscapeLayer(() => {
      setView('list');
    });
  }, [showEffortView]);

  // List view: ↑/↓ walk the filtered list, → drills into the effort slider.
  // In the effort view the slider owns the arrows.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (view !== 'list' || filterOpen || !e.key.startsWith('Arrow')) return;
      const inSearch = e.target instanceof HTMLInputElement && e.target.value.length > 0;
      const horizontal = e.key === 'ArrowLeft' || e.key === 'ArrowRight';
      if (inSearch && horizontal) return;
      if (e.key === 'ArrowRight') {
        if (canDrill) {
          e.preventDefault();
          setView('effort');
        }
        return;
      }
      if (e.key === 'ArrowLeft') return;
      e.preventDefault();
      const next = stepModel(models, selectedRowId, e.key === 'ArrowDown');
      if (next) updateModel(next);
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
    };
  }, [view, filterOpen, canDrill, models, selectedRowId, updateModel]);

  return (
    <div
      ref={panelRef}
      style={{ width: WIDTH_PX, maxWidth: MAX_WIDTH }}
      className="flex min-h-0 flex-1 flex-col"
    >
      <AnimatePresence mode="wait" initial={false}>
        {showEffortView ? (
          <motion.div
            key="effort"
            initial={{ opacity: 0, x: 12 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: 12 }}
            transition={{ duration: 0.14, ease: [0.16, 1, 0.3, 1] }}
            className="px-3 pt-2 pb-3"
          >
            <div className="flex h-8 items-center gap-1.5">
              <button
                type="button"
                aria-label="Back to models"
                onClick={() => {
                  setView('list');
                }}
                className="flex h-6 w-6 shrink-0 items-center justify-center rounded-sm text-muted transition-colors hover:bg-surface/60 hover:text-primary"
              >
                <ChevronLeft className="h-4 w-4" />
              </button>
              {offersFastMode(provider) && (
                <Tooltip label={fastModeBlocked ?? `${FAST_MODE_LABEL} · ${FAST_MODE_HINT}`}>
                  <button
                    type="button"
                    aria-pressed={fastMode}
                    aria-label={FAST_MODE_LABEL}
                    aria-description={fastModeBlocked ?? FAST_MODE_HINT}
                    disabled={fastModeBlocked !== undefined}
                    onClick={() => {
                      setFastMode(!fastMode);
                    }}
                    className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-sm transition-colors disabled:opacity-40 ${
                      fastMode
                        ? 'bg-surface text-accent'
                        : 'text-muted enabled:hover:bg-surface/60 enabled:hover:text-primary'
                    }`}
                  >
                    <Zap
                      size={14}
                      className="transition-colors"
                      fill={fastMode ? 'currentColor' : 'transparent'}
                    />
                  </button>
                </Tooltip>
              )}
              <span className="flex h-4 w-4 shrink-0 items-center justify-center">
                <ModelIcon provider={providerOf(activeModel, resolvedModelId)} size={14} />
              </span>
              {isDroidProxyModel(activeModel, resolvedModelId) && (
                <span className="shrink-0 flex items-center">
                  <DroidProxyMark size={12} />
                </span>
              )}
              <span className="min-w-0 flex-1 truncate text-body-strong text-primary">
                {shortModelName(selectedLabel)}
              </span>
              {offersContextWindow(provider) && (
                <ContextWindowMenu
                  options={contextWindowOptions(activeModel, defaultWindow)}
                  selected={contextWindowTokens}
                  onSelect={setContextWindow}
                />
              )}
              {canReset && (
                <button
                  type="button"
                  aria-label="Reset to the model's default effort"
                  title="Reset to the model's default effort"
                  onClick={() => {
                    sliderRef.current?.setValue(defaultEffort, { emit: true });
                  }}
                  className="flex h-6 w-6 shrink-0 items-center justify-center rounded-sm text-muted transition-colors hover:bg-surface/60 hover:text-primary"
                >
                  <RotateCcw className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
            <EffortSlider
              ref={sliderRef}
              levels={levels}
              value={sliderValue}
              autoFocus
              onCommit={commitEffort}
              style={SLIDER_STYLE}
              helpAnchor={panelRef}
            />
          </motion.div>
        ) : (
          <motion.div
            key="list"
            initial={{ opacity: 0, x: -12 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -12 }}
            transition={{ duration: 0.14, ease: [0.16, 1, 0.3, 1] }}
            className="flex min-h-0 flex-col"
          >
            {showHarness && (
              <HarnessSegments
                provider={provider}
                statuses={providerStatuses}
                locked={harnessLocked}
                onSelect={selectHarness}
              />
            )}

            <div className="flex min-h-0 flex-col px-3 pt-3 pb-3">
              <div className="flex shrink-0 items-center gap-1.5">
                <div className="flex h-8 min-w-0 flex-1 items-center gap-2 rounded-md bg-bg/50 px-3">
                  <Search className="h-3.5 w-3.5 shrink-0 text-muted" />
                  <input
                    autoFocus
                    value={query}
                    onChange={(e) => {
                      setQuery(e.target.value);
                    }}
                    placeholder="Search models"
                    className="min-w-0 flex-1 bg-transparent text-body text-primary placeholder-muted focus:outline-none"
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

              <div className="px-0.5 pb-1 pt-2.5 text-caption text-muted">Select model</div>

              <ModelSliderCatalogList
                models={models}
                hasRealModels={hasRealModels}
                selectedModelId={selectedRowId}
                query={query}
                drillLabel={drillLabel}
                drillUltra={canDrill && shownEffort === 'ultra'}
                onSelectModel={updateModel}
                onDrill={() => {
                  setView('effort');
                }}
              />
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
