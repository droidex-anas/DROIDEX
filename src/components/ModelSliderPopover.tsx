import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
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
import { effortsFor } from './ModelCatalogList';
import { fitToWindow } from './composer/popoverFit';
import useModelPicker from './useModelPicker';
import ModelSliderCatalogList from './ModelSliderCatalogList';
import EffortSlider from './effortSlider/EffortSlider';
import type { EffortSliderElement, EffortSliderLevel } from './effortSlider/effortSliderElement';

const PREFERRED_WIDTH_PX = 320;
const MIN_WIDTH_PX = 280;

// The slider names levels in the reference design's vocabulary; 'ultra' keeps
// the harness's own word (Ultracode on Claude, Ultra elsewhere) via the labeler.
const EFFORT_DISPLAY: Partial<Record<ReasoningEffort, string>> = {
  off: 'Off',
  none: 'None',
  minimal: 'Minimal',
  low: 'Low',
  medium: 'Medium',
  high: 'High',
  xhigh: 'Extra',
  max: 'Max',
  dynamic: 'Dynamic',
};

const capitalize = (word: string) => word.charAt(0).toUpperCase() + word.slice(1);

function effortDisplay(effort: ReasoningEffort, provider: ProviderKind): string {
  if (effort === 'ultra') return capitalize(reasoningEffortLabel(effort, provider));
  return EFFORT_DISPLAY[effort] ?? capitalize(effort);
}

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
  const [fit, setFit] = useState<{ width: number; left: number }>();

  useLayoutEffect(() => {
    const refit = () => {
      const anchor = ref.current?.offsetParent;
      if (!anchor) return;
      setFit(
        fitToWindow(
          anchor.getBoundingClientRect().left,
          window.innerWidth,
          PREFERRED_WIDTH_PX,
          MIN_WIDTH_PX,
        ),
      );
    };
    refit();
    window.addEventListener('resize', refit);
    return () => {
      window.removeEventListener('resize', refit);
    };
  }, []);

  const panelWidth = fit?.width ?? PREFERRED_WIDTH_PX;

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
    levels.find((level) => level.value === shownEffort)?.value ?? levels.at(-1)?.value ?? '';
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

  const sliderStyle = useMemo(
    () =>
      ({
        // The panel is 218 units wide; the unit scales it to the card's content box.
        '--effort-unit': `${String((panelWidth - 24) / 218)}px`,
        '--effort-surface': 'var(--droid-bg)',
        '--effort-border': 'var(--droid-border)',
        '--effort-text': 'var(--droid-text)',
        '--effort-muted': 'var(--droid-text-muted)',
        '--effort-fill': 'color-mix(in srgb, var(--droid-text) 45%, transparent)',
        '--effort-accent': 'var(--droid-ultra, #a392e5)',
      }) as CSSProperties,
    [panelWidth],
  );

  const commitEffort = (value: string) => {
    if (isReasoningEffort(value)) updateReasoning(value);
    setView('list');
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
      const ids: (string | undefined)[] = [undefined, ...models.map((m) => m.id)];
      // Nothing matches the filter: stepping would silently switch to Default.
      if (ids.length < 2) return;
      const idx = ids.indexOf(resolvedModelId);
      const down = e.key === 'ArrowDown';
      const next =
        idx === -1
          ? down
            ? Math.min(1, ids.length - 1)
            : ids.length - 1
          : Math.min(ids.length - 1, Math.max(0, idx + (down ? 1 : -1)));
      if (next !== idx) updateModel(ids[next]);
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
      style={fit ?? { width: PREFERRED_WIDTH_PX }}
      className="absolute bottom-full left-0 mb-3 max-w-[calc(100vw-2rem)] z-50"
    >
      <div className="rounded-2xl border border-droid-border bg-droid-elevated shadow-droid overflow-hidden">
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
                  className="grid h-6 w-6 shrink-0 place-items-center rounded-md text-droid-text-muted transition-colors hover:bg-droid-surface/60 hover:text-droid-text"
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
                    className="grid h-6 w-6 shrink-0 place-items-center rounded-md text-droid-text-muted transition-colors hover:bg-droid-surface/60 hover:text-droid-text"
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
                style={sliderStyle}
              />
            </motion.div>
          ) : (
            <motion.div
              key="list"
              initial={{ opacity: 0, x: -12 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -12 }}
              transition={{ duration: 0.14, ease: [0.16, 1, 0.3, 1] }}
            >
              {showHarness && (
                <HarnessSegments
                  provider={provider}
                  statuses={providerStatuses}
                  locked={harnessLocked}
                  onSelect={selectHarness}
                />
              )}

              <div className="px-3 pt-3 pb-3">
                <div className="flex h-9 items-center gap-2 rounded-lg border border-droid-border bg-droid-bg/60 px-3 transition-colors focus-within:border-droid-border-hover">
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
      <div className="absolute -bottom-1.5 left-7 h-3 w-3 rotate-45 border-r border-b border-droid-border bg-droid-elevated" />
    </motion.div>
  );
}
