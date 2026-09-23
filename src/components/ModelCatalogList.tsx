import { memo, useCallback, useRef } from 'react';
import { offersReasoningEffort, reasoningEffortLabel } from '../lib/reasoningEffort';
import type { ModelInfo, ProviderKind, ReasoningEffort } from '../types/bridge';
import { ModelIcon, providerOf } from './ModelIcon';
import { ModelListStatus, SelectionHighlight, useModelListVirtualizer } from './modelListParts';

/** The catalog entry Droid CLI falls back to when no model is chosen. */
export function defaultModelOf(models: ModelInfo[]) {
  return models.find((m) => m.isDefault && !m.isCustom);
}

/** Effort choices a row exposes: the model's supported set, or its single fixed default. */
export function effortsFor(model: ModelInfo | undefined, fallback?: ReasoningEffort) {
  const supported = model?.supportedReasoningEfforts;
  if (supported?.length) return supported;
  const effort = model?.defaultReasoningEffort ?? fallback;
  return effort === undefined ? [] : [effort];
}

export function stepEffort(
  efforts: ReasoningEffort[],
  current: ReasoningEffort | undefined,
  delta: number,
): ReasoningEffort | undefined {
  if (current === undefined) return delta > 0 ? efforts[0] : efforts.at(-1);
  const idx = efforts.indexOf(current);
  const base = idx === -1 ? efforts.length - 1 : idx;
  return efforts[Math.min(efforts.length - 1, Math.max(0, base + delta))];
}

// Where an ↑/↓ step lands in the filtered list: undefined when nothing matches
// or the selection is already at that end. A model the filter hides steps onto
// the first or last visible entry.
export function stepModel(
  models: ModelInfo[],
  current: string | undefined,
  down: boolean,
): string | undefined {
  if (models.length === 0) return undefined;
  const last = models.length - 1;
  const index = models.findIndex((model) => model.id === current);
  if (index === -1) return models[down ? 0 : last].id;
  const next = Math.min(last, Math.max(0, index + (down ? 1 : -1)));
  return next === index ? undefined : models[next].id;
}

type Pick = (modelId: string, effort?: ReasoningEffort) => void;

function ModelCatalogList({
  models,
  hasRealModels,
  provider,
  selectedModelId,
  reasoning,
  query,
  onSelectModel,
  onSelectReasoning,
  disabled,
  reasoningLocked,
  showReasoning = true,
}: {
  models: ModelInfo[];
  hasRealModels: boolean;
  /** The harness these rows belong to; it names the top effort level. */
  provider: ProviderKind;
  selectedModelId: string | undefined;
  reasoning: ReasoningEffort | undefined;
  query: string;
  onSelectModel: (modelId: string) => void;
  onSelectReasoning: (reasoning: ReasoningEffort) => void;
  disabled: boolean;
  reasoningLocked: boolean;
  /** False where the provider publishes no efforts, so no row offers one. */
  showReasoning?: boolean;
}) {
  const rows = hasRealModels ? models : [];
  // -1 when the active model is filtered out: nothing is highlighted then.
  const selectedIndex = rows.findIndex((model) => model.id === selectedModelId);

  const { scrollRef, virtualizer } = useModelListVirtualizer(rows.length, selectedIndex);

  const latest = useRef({ selectedModelId, onSelectModel, onSelectReasoning });
  latest.current = { selectedModelId, onSelectModel, onSelectReasoning };
  const pick = useCallback<Pick>((modelId, effort) => {
    const cur = latest.current;
    if (modelId !== cur.selectedModelId) cur.onSelectModel(modelId);
    if (effort) cur.onSelectReasoning(effort);
  }, []);

  const rowProps = { pick, provider, disabled, reasoningLocked, showReasoning };

  return (
    <div ref={scrollRef} className="mt-2 max-h-[200px] min-h-0 overflow-y-auto -mx-1 px-1">
      <div
        role="listbox"
        aria-label="Models"
        className="relative"
        style={{ height: `${String(virtualizer.getTotalSize())}px` }}
      >
        <SelectionHighlight index={selectedIndex} />
        {virtualizer.getVirtualItems().map((item) => {
          const model = rows[item.index];
          const selected = item.index === selectedIndex;
          return (
            <div
              key={model.id}
              className="absolute inset-x-0 top-0"
              style={{ transform: `translateY(${String(item.start)}px)` }}
            >
              <ModelRow
                model={model}
                selected={selected}
                reasoning={selected ? reasoning : undefined}
                {...rowProps}
              />
            </div>
          );
        })}
      </div>
      <ModelListStatus hasRealModels={hasRealModels} empty={models.length === 0} query={query} />
    </div>
  );
}

export default memo(ModelCatalogList);

const ModelRow = memo(function ModelRow({
  model,
  selected,
  reasoning,
  pick,
  provider,
  disabled,
  reasoningLocked,
  showReasoning,
}: {
  model: ModelInfo;
  selected: boolean;
  /** Only set on the selected row; other rows show their model's default. */
  reasoning?: ReasoningEffort;
  pick: Pick;
  provider: ProviderKind;
  disabled: boolean;
  reasoningLocked: boolean;
  showReasoning: boolean;
}) {
  const { id, displayName: label } = model;
  // A model whose harness offers no effort for it gets no stepper, the way the
  // composer badge and the context panel already drop the pill for it.
  const offersReasoning = showReasoning && offersReasoningEffort(model);
  const efforts = effortsFor(model, reasoning);
  const shown = selected ? reasoning : (model.defaultReasoningEffort ?? efforts.at(-1));
  const current = shown === undefined ? -1 : efforts.indexOf(shown);
  const canStep = efforts.length > 1 && !reasoningLocked;
  // The one level with a state of its own: the active row's dots and word go
  // purple and the dots pick up the shimmer.
  const ultra = selected && shown === 'ultra';
  const lockTitle = reasoningLocked ? 'Change the child model to adjust reasoning.' : undefined;

  const arrow = (delta: -1 | 1) => (
    <button
      type="button"
      tabIndex={-1}
      aria-label={delta < 0 ? 'Lower reasoning effort' : 'Raise reasoning effort'}
      disabled={disabled || !canStep}
      onClick={(e) => {
        e.stopPropagation();
        pick(id, stepEffort(efforts, shown, delta));
      }}
      className={`w-4 shrink-0 text-[11px] text-droid-text-secondary hover:text-droid-text transition-opacity ${
        selected && canStep ? '' : 'opacity-0 pointer-events-none'
      }`}
    >
      {delta < 0 ? '←' : '→'}
    </button>
  );

  return (
    <div
      role="option"
      tabIndex={selected ? 0 : -1}
      aria-selected={selected}
      aria-disabled={disabled || undefined}
      // A click must not focus the row: the popover steps effort from a window
      // keydown, and the first arrow after a focusing click would otherwise
      // draw the browser's focus ring on the row.
      onMouseDown={(e) => {
        e.preventDefault();
      }}
      onClick={() => {
        if (!disabled) pick(id);
      }}
      onKeyDown={(e) => {
        if (e.key !== 'Enter' && e.key !== ' ') return;
        e.preventDefault();
        if (!disabled) pick(id);
      }}
      title={label}
      className={`relative flex items-center gap-2.5 h-10 px-2.5 rounded-lg select-none ${
        disabled
          ? 'cursor-not-allowed opacity-50'
          : selected
            ? 'cursor-default'
            : 'cursor-pointer hover:bg-droid-surface/60'
      }`}
    >
      <span
        className={`w-4 h-4 shrink-0 flex items-center justify-center ${selected ? '' : 'opacity-70'}`}
      >
        <ModelIcon provider={providerOf(model)} size={16} />
      </span>
      <span className="min-w-0 flex-1 truncate text-[14px] font-medium text-droid-text">
        {label}
      </span>
      {offersReasoning && (
        <>
          {arrow(-1)}
          <span className="flex gap-1 shrink-0" title={lockTitle}>
            {efforts.map((effort, i) => {
              const filled = i <= current;
              return (
                <button
                  key={effort}
                  type="button"
                  tabIndex={-1}
                  aria-label={`${label}: ${effort}`}
                  aria-pressed={effort === shown}
                  disabled={disabled || reasoningLocked}
                  onClick={(e) => {
                    e.stopPropagation();
                    pick(id, effort);
                  }}
                  className={`w-2.5 h-2.5 rounded-[3px] ${dotFill(filled, selected, ultra)} ${
                    disabled || reasoningLocked ? 'cursor-not-allowed' : ''
                  }`}
                  style={{
                    transition: 'background .2s, transform .25s cubic-bezier(.34,1.56,.64,1)',
                    transitionDelay: `${String(i * 25)}ms`,
                    transform: filled && selected ? 'scale(1.08)' : undefined,
                    // Staggering the shared cycle is what makes the band travel.
                    ...(ultra ? { animationDelay: `${String(i * 130)}ms` } : {}),
                  }}
                />
              );
            })}
          </span>
          {arrow(1)}
          <span
            className={`w-[62px] shrink-0 text-[12px] capitalize truncate ${effortWordTone(selected, ultra)}`}
          >
            {shown === undefined ? 'Default' : reasoningEffortLabel(shown, provider)}
          </span>
        </>
      )}
    </div>
  );
});

function dotFill(filled: boolean, selected: boolean, ultra: boolean): string {
  if (!filled) return 'bg-droid-text-muted/30';
  if (!selected) return 'bg-droid-text-muted';
  return ultra ? 'bg-droid-ultra effort-dot-ultra' : 'bg-droid-accent';
}

function effortWordTone(selected: boolean, ultra: boolean): string {
  if (ultra) return 'text-droid-ultra';
  return selected ? 'text-droid-text' : 'text-droid-text-secondary';
}
