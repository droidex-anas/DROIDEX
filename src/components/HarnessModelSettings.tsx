import { useEffect } from 'react';
import { shallowEqual, useStoreDispatch, useStoreSelector } from '../hooks/useStore';
import type { HarnessModel } from '../hooks/persistedUiPreferences';
import { listModels, refreshProviders } from '../lib/commands';
import {
  draftEffortFor,
  isReasoningEffort,
  reasoningAfterModelSwitch,
  reasoningEffortLabel,
} from '../lib/reasoningEffort';
import {
  PROVIDER_LABELS,
  PROVIDER_MARKS,
  providerDefaultModel,
  providerModelCatalog,
  providerModelSelection,
  providerUnavailableReason,
} from '../features/providers/providerIdentity';
import type { ModelInfo, ProviderKind, ProviderStatus } from '../types/bridge';
import { ModelIcon, providerOf } from './ModelIcon';
import { Dropdown } from './settingsKit';

const HARNESSES = Object.keys(PROVIDER_LABELS) as ProviderKind[];
const DEFAULT_VALUE = '';

function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/**
 * The model and reasoning effort a new chat starts with on each harness. These
 * are DROIDEX preferences: "Default" defers to the harness CLI's own setting.
 */
export function HarnessModelSettings() {
  const dispatch = useStoreDispatch();
  const state = useStoreSelector(
    (current) => ({
      harnessModels: current.harnessModels,
      models: current.models,
      providerStatuses: current.providerStatuses,
    }),
    shallowEqual,
  );

  // Readiness can be stale when settings open, and Droid's catalog arrives on request.
  const needsDroidCatalog = state.models.length === 0;
  useEffect(() => {
    refreshProviders();
  }, []);
  useEffect(() => {
    if (needsDroidCatalog) listModels();
  }, [needsDroidCatalog]);

  return (
    <div className="rounded-xl border border-droid-border bg-droid-surface divide-y divide-droid-border mb-8">
      {HARNESSES.map((provider) => (
        <HarnessModelRow
          key={provider}
          provider={provider}
          saved={state.harnessModels[provider]}
          droidModels={state.models}
          statuses={state.providerStatuses}
          onChange={(model) => {
            dispatch({ type: 'SET_HARNESS_MODEL', provider, model });
          }}
        />
      ))}
    </div>
  );
}

function HarnessModelRow({
  provider,
  saved,
  droidModels,
  statuses,
  onChange,
}: {
  provider: ProviderKind;
  saved: HarnessModel;
  droidModels: ModelInfo[];
  statuses: ProviderStatus[];
  onChange: (model: HarnessModel) => void;
}) {
  const label = PROVIDER_LABELS[provider];
  const catalog = providerModelCatalog(provider, droidModels, statuses);
  const harnessDefault = providerDefaultModel(provider, catalog, statuses);
  const modelId = providerModelSelection(provider, saved.modelId, catalog);
  const model = modelId ? catalog.find((entry) => entry.id === modelId) : harnessDefault;
  const efforts = model?.supportedReasoningEfforts ?? [];
  const reasoning = efforts.length > 0 ? draftEffortFor(model, saved.reasoning) : undefined;

  const unavailable = providerUnavailableReason(
    statuses.find((entry) => entry.provider === provider),
  );

  const modelOptions = [
    {
      value: DEFAULT_VALUE,
      label: harnessDefault ? `Default (${harnessDefault.displayName})` : 'Default',
    },
    ...catalog.map((entry) => ({
      value: entry.id,
      label: entry.displayName,
      icon: <ModelIcon provider={providerOf(entry)} size={14} />,
    })),
  ];
  const defaultEffort = model?.defaultReasoningEffort;
  const effortOptions = [
    {
      value: DEFAULT_VALUE,
      label: defaultEffort
        ? `Default (${capitalize(reasoningEffortLabel(defaultEffort, provider))})`
        : 'Default',
    },
    ...efforts.map((effort) => ({
      value: effort,
      label: capitalize(reasoningEffortLabel(effort, provider)),
    })),
  ];

  const selectModel = (value: string) => {
    const nextId = value === DEFAULT_VALUE ? undefined : value;
    const next = nextId ? catalog.find((entry) => entry.id === nextId) : harnessDefault;
    onChange({ modelId: nextId, reasoning: reasoningAfterModelSwitch(next, saved.reasoning) });
  };

  const selectEffort = (value: string) => {
    onChange({ modelId: saved.modelId, reasoning: isReasoningEffort(value) ? value : undefined });
  };

  return (
    <div className="flex items-center justify-between gap-4 px-4 py-3">
      <div className="flex min-w-0 items-center gap-2.5">
        <ModelIcon provider={PROVIDER_MARKS[provider]} size={16} />
        <div className="min-w-0">
          <div className="text-[13px] text-droid-text">{label}</div>
          <div className="text-[11px] text-droid-text-muted mt-0.5 truncate">
            {unavailable ?? `New ${label} chats start here.`}
          </div>
        </div>
      </div>
      {unavailable === null && (
        <div className="flex shrink-0 items-center gap-2">
          <Dropdown
            ariaLabel={`${label} default model`}
            value={modelId ?? DEFAULT_VALUE}
            options={modelOptions}
            placeholder={saved.modelId ?? 'Default'}
            width="w-56"
            onChange={selectModel}
          />
          {efforts.length > 0 ? (
            <Dropdown
              ariaLabel={`${label} default reasoning effort`}
              value={reasoning ?? DEFAULT_VALUE}
              options={effortOptions}
              width="w-36"
              onChange={selectEffort}
            />
          ) : (
            // Keeps the model column aligned across harnesses.
            <div className="w-36" aria-hidden />
          )}
        </div>
      )}
    </div>
  );
}
