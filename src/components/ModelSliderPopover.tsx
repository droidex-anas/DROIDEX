import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { ChevronLeft, RotateCcw, Search } from 'lucide-react';
import type { ProviderKind, ReasoningEffort } from '../types/bridge';
import {
  isReasoningEffort,
  offersReasoningEffort,
  reasoningEffortLabel,
} from '../lib/reasoningEffort';
import { ModelIcon, providerOf } from './ModelIcon';
import HarnessSegments from '../features/providers/HarnessSegments';
import ModelCategoryFilter from './ModelCategoryFilter';
import { effortsFor, stepModel } from './ModelCatalogList';
import { useTriggerAnchor } from './composer/useTriggerAnchor';
import useModelPicker from './useModelPicker';
import ModelSliderCatalogList from './ModelSliderCatalogList';
import EffortSlider from './effortSlider/EffortSlider';
import type { EffortSliderElement, EffortSliderLevel } from './effortSlider/effortSliderElement';

const PREFERRED_WIDTH_PX = 320;

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
  '--effort-text': 'var(--droid-text)',
  '--effort-muted': 'var(--droid-text-muted)',
  '--effort-fill': 'color-mix(in srgb, var(--droid-text) 45%, transparent)',
  '--effort-accent': 'var(--droid-ultra, #a392e5)',
} as CSSProperties;

/**
 * The alternative composer model selector: a card that lists models and drills
 * into a spring effort slider for the selected one. Scoped to a single chat;
 * Mission Control and exact-child pickers keep the classic popover.
 */
export default function ModelSliderPopover({ onClose }: { onClose: () => void }) {
  const {
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
  } = useModelPicker({ singleAgent: true });
  const [view, setView] = useState<'list' | 'effort'>('list');
  const ref = useRef<HTMLDivElement>(null);
  const sliderRef = useRef<EffortSliderElement>(null);
  const [card, setCard] = useState<HTMLDivElement | null>(null);
  const { width, maxHeight, tailRight } = useTriggerAnchor(ref, PREFERRED_WIDTH_PX);

  const efforts = effortsFor(activeModel, effReasoning);
  const canDrill =
    activeModel !== undefined &&
    showsReasoning &&
    offersReasoningEffort(activeModel) &&
    efforts.length > 1;

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

  const defaultEffort = activeModel?.defaultReasoningEffort;
  const canReset =
    defaultEffort !== undefined &&
    defaultEffort !== sliderValue &&
    levels.some((level) => level.value === defaultEffort);

  // A pick keeps the slider open: releasing the thumb is not a request to leave.
  const commitEffort = (value: string) => {
    if (isReasoningEffort(value)) updateReasoning(value);
  };

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    window.addEventListener('mousedown', onDown);
    return () => {
      window.removeEventListener('mousedown', onDown);
    };
  }, [onClose]);

  // List view: ↑/↓ walk the filtered list, → drills into the effort slider.
  // In the effort view the slider owns the arrows; Escape backs out of it.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (view === 'effort') setView('list');
        else onClose();
        return;
      }
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
      const step = stepModel(models, resolvedModelId, e.key === 'ArrowDown');
      if (step) updateModel(step.modelId);
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
    };
  }, [view, filterOpen, canDrill, models, resolvedModelId, updateModel, onClose]);

  return (
    <motion.div
      ref={ref}
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 8 }}
      transition={{ duration: 0.16, ease: [0.16, 1, 0.3, 1] }}
      style={{ width, maxHeight }}
      className="absolute bottom-full right-0 mb-3 z-50"
    >
      <div
        ref={setCard}
        className="flex max-h-[inherit] flex-col overflow-hidden rounded-2xl border border-droid-border/60 bg-droid-elevated shadow-droid"
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
                  className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-droid-text-muted transition-colors hover:bg-droid-surface/60 hover:text-droid-text"
                >
                  <ChevronLeft className="h-4 w-4" />
                </button>
                <span className="flex h-4 w-4 shrink-0 items-center justify-center">
                  <ModelIcon provider={providerOf(activeModel, resolvedModelId)} size={14} />
                </span>
                <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-droid-text">
                  {selectedLabel}
                </span>
                {canReset && (
                  <button
                    type="button"
                    aria-label="Reset to the model's default effort"
                    title="Reset to the model's default effort"
                    onClick={() => {
                      sliderRef.current?.setValue(defaultEffort, { emit: true });
                    }}
                    className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-droid-text-muted transition-colors hover:bg-droid-surface/60 hover:text-droid-text"
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
                helpAnchor={card}
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
                <div className="flex h-8 shrink-0 items-center gap-2 rounded-lg bg-droid-bg/50 px-3">
                  <Search className="h-3.5 w-3.5 shrink-0 text-droid-text-muted" />
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

                <div className="px-0.5 pt-2.5 pb-1 text-[11px] text-droid-text-muted">
                  Select model
                </div>

                <ModelSliderCatalogList
                  models={models}
                  defaultModel={defaultModel}
                  hasRealModels={hasRealModels}
                  selectedModelId={resolvedModelId}
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

      {/* Tail */}
      <div
        className="absolute -bottom-1.5 h-3 w-3 rotate-45 border-r border-b border-droid-border/60 bg-droid-elevated"
        style={{ right: tailRight }}
      />
    </motion.div>
  );
}
