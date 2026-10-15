import { ChevronDown, Search } from 'lucide-react';
import { X } from '@droidex/icons';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Button } from '../../components/ui/Button';
import { Input } from '../../components/ui/Field';
import { Popover } from '../../components/ui/Popover';
import ModelCatalogList from '../../components/ModelCatalogList';
import { isDroidCoreModel } from '../../components/modelCategories';
import { ModelIcon, providerOf } from '../../components/ModelIcon';
import { listModels } from '../../lib/commands';
import type { ModelInfo, ReasoningEffort } from '../../types/bridge';
import { reasoningForModel } from './modelSelection';

type ModelCategory = 'core' | 'factory' | 'custom';
const MODEL_CATEGORIES: readonly ModelCategory[] = ['core', 'factory', 'custom'];

const CATEGORY_LABEL: Record<ModelCategory, string> = {
  core: 'Droid core',
  factory: 'Factory',
  custom: 'Custom',
};

const BASE_REASONING: ReasoningEffort[] = [
  'off',
  'none',
  'minimal',
  'low',
  'medium',
  'high',
  'xhigh',
  'max',
  'dynamic',
];

export function AutomationModelPicker({
  models,
  modelId,
  reasoningEffort,
  onChange,
}: {
  models: ModelInfo[];
  modelId: string | null;
  reasoningEffort: ReasoningEffort | null;
  onChange: (selection: { modelId: string; reasoningEffort: ReasoningEffort }) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState<ModelCategory | 'all'>('all');
  const buttonRef = useRef<HTMLButtonElement>(null);
  const selectedModel = models.find((model) => model.id === modelId);
  const selectedReasoning = reasoningForModel(selectedModel, reasoningEffort);

  const close = useCallback(() => {
    setOpen(false);
    setQuery('');
    setCategory('all');
  }, []);

  useEffect(() => {
    if (models.length === 0) listModels();
  }, [models.length]);

  const filteredModels = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    return models.filter((model) => {
      if (category !== 'all' && categoryOf(model) !== category) return false;
      if (!normalized) return true;
      return (
        model.displayName.toLowerCase().includes(normalized) ||
        model.id.toLowerCase().includes(normalized) ||
        (model.provider ?? '').toLowerCase().includes(normalized)
      );
    });
  }, [category, models, query]);

  const categoryCounts = useMemo(() => {
    const counts: Record<ModelCategory, number> = { core: 0, factory: 0, custom: 0 };
    for (const model of models) counts[categoryOf(model)] += 1;
    return counts;
  }, [models]);

  const reasoningOptions = reasoningOptionsForModel(selectedModel, selectedReasoning);
  const label =
    selectedModel?.displayName ??
    modelId ??
    (models.length === 0 ? 'Loading models…' : 'Choose model');

  // Picking an effort dot on another row selects that model and then its
  // effort in one gesture, before this component re-renders; the second call
  // must write the model just picked, not the one the last render knew.
  const pickedModelId = useRef(modelId);
  pickedModelId.current = modelId;
  const selectModel = (nextModelId: string) => {
    const nextModel = models.find((model) => model.id === nextModelId);
    if (!nextModel) return;
    pickedModelId.current = nextModel.id;
    onChange({
      modelId: nextModel.id,
      reasoningEffort: reasoningForModel(nextModel, selectedReasoning),
    });
  };
  const selectReasoning = (reasoning: ReasoningEffort) => {
    const id = pickedModelId.current;
    if (!id) return;
    onChange({ modelId: id, reasoningEffort: reasoning });
  };

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        aria-label="Choose automation model and reasoning"
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => {
          if (open) close();
          else setOpen(true);
        }}
        className={`inline-flex max-w-72 items-center gap-2 rounded-lg px-2.5 py-1.5 text-left transition-colors ${
          open ? 'bg-elevated' : 'hover:bg-elevated/70'
        }`}
      >
        <span className="flex h-5 w-5 shrink-0 items-center justify-center">
          <ModelIcon provider={providerOf(selectedModel)} size={17} />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-body-strong text-primary">{label}</span>
          <span className="block text-caption capitalize text-muted">
            {modelId ? `${selectedReasoning} reasoning` : 'Select from your model catalog'}
          </span>
        </span>
        <ChevronDown
          className={`size-icon-sm shrink-0 text-muted transition-transform ${open ? 'rotate-180' : ''}`}
        />
      </button>

      <Popover
        open={open}
        anchorRef={buttonRef}
        onClose={close}
        label="Select automation model and reasoning"
        placement="bottom-end"
        width={390}
      >
        {/* `inherit` keeps this column inside the height the popover resolved,
            so the reasoning row, catalog, and Done control stay reachable. */}
        <div className="flex min-h-0 flex-col" style={{ maxHeight: 'inherit' }}>
          <div className="flex items-start justify-between gap-3 px-4 pb-3 pt-3.5">
            <div>
              <div className="text-label text-secondary">Model and reasoning</div>
              <div className="mt-0.5 text-caption text-muted">
                Uses the same live catalog as the chat composer
              </div>
            </div>
            <Button
              variant="ghost"
              size="sm"
              icon={X}
              aria-label="Close model selector"
              title="Close model selector"
              onClick={close}
            />
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto">
            <div className="px-4 pb-2 pt-3.5">
              <div className="mb-2 flex items-center justify-between">
                <span className="text-label text-muted">Reasoning</span>
                <span className="text-label capitalize text-primary">{selectedReasoning}</span>
              </div>
              <div className="flex flex-wrap gap-1 rounded-lg bg-elevated p-1 dark:bg-bg/65">
                {reasoningOptions.map((reasoning) => {
                  const selected = reasoning === selectedReasoning;
                  return (
                    <button
                      key={reasoning}
                      type="button"
                      onClick={() => {
                        if (!selectedModel) return;
                        onChange({ modelId: selectedModel.id, reasoningEffort: reasoning });
                      }}
                      disabled={!selectedModel}
                      className={`rounded-md px-2.5 py-1.5 text-caption capitalize transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${
                        selected
                          ? 'bg-raised text-primary shadow-sm'
                          : 'text-muted hover:bg-active hover:text-primary'
                      }`}
                    >
                      {reasoning}
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="px-4 pb-3 pt-2">
              <div className="flex h-control-lg items-center gap-2 rounded-md bg-field px-3 text-muted">
                <Search className="size-icon-sm shrink-0" />
                <Input
                  variant="embedded"
                  autoFocus
                  value={query}
                  aria-label="Search models"
                  onChange={(event) => {
                    setQuery(event.target.value);
                  }}
                  placeholder="Search models"
                />
              </div>

              <div className="mt-2 flex flex-wrap gap-1">
                <CategoryButton
                  label="All"
                  active={category === 'all'}
                  onClick={() => {
                    setCategory('all');
                  }}
                />
                {MODEL_CATEGORIES.map((value) =>
                  categoryCounts[value] > 0 ? (
                    <CategoryButton
                      key={value}
                      label={CATEGORY_LABEL[value]}
                      count={categoryCounts[value]}
                      active={category === value}
                      onClick={() => {
                        setCategory(value);
                      }}
                    />
                  ) : null,
                )}
              </div>

              <ModelCatalogList
                models={filteredModels}
                hasRealModels={models.length > 0}
                provider="droid"
                selectedModelId={modelId ?? undefined}
                reasoning={selectedReasoning}
                query={query}
                onSelectModel={selectModel}
                onSelectReasoning={selectReasoning}
                disabled={false}
                reasoningLocked={false}
              />
            </div>
          </div>

          <div className="flex items-center justify-between gap-3 px-4 py-3">
            <span className="min-w-0 truncate text-caption text-muted">
              {selectedModel
                ? `${selectedModel.displayName} · ${selectedReasoning} reasoning`
                : modelId
                  ? `${modelId} · ${selectedReasoning} reasoning`
                  : 'Choose a model to continue'}
            </span>
            <Button variant="primary" size="sm" onClick={close} disabled={!modelId}>
              Done
            </Button>
          </div>
        </div>
      </Popover>
    </>
  );
}

function CategoryButton({
  label,
  count,
  active,
  onClick,
}: {
  label: string;
  count?: number;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-md px-2.5 py-1 text-caption transition-colors ${
        active ? 'bg-active text-primary' : 'text-muted hover:bg-active hover:text-primary'
      }`}
    >
      {label}
      {count !== undefined ? ` ${String(count)}` : ''}
    </button>
  );
}

function categoryOf(model: ModelInfo): ModelCategory {
  if (model.isCustom || model.id.startsWith('custom:')) return 'custom';
  return isDroidCoreModel(model) ? 'core' : 'factory';
}

function reasoningOptionsForModel(
  model: ModelInfo | undefined,
  current: ReasoningEffort,
): ReasoningEffort[] {
  if (!model) return BASE_REASONING;
  if (model.supportedReasoningEfforts?.length) return model.supportedReasoningEfforts;
  if (model.defaultReasoningEffort) return [model.defaultReasoningEffort];
  return BASE_REASONING.includes(current) ? BASE_REASONING : [current, ...BASE_REASONING];
}
