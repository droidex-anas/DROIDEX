import { useCallback, useEffect, useMemo, useState } from 'react';
import { shallowEqual, useStoreDispatch, useStoreSelector } from '../hooks/useStore';
import type { AgentKind, HarnessModel } from '../hooks/persistedUiPreferences';
import type { ProviderKind, ReasoningEffort } from '../types/bridge';
import {
  draftEffortFor,
  reasoningAfterModelSwitch,
  reasoningForModelSwitch,
} from '../lib/reasoningEffort';
import { displayedModelSettings, type PendingModelSettings } from '../lib/pendingModelSettings';
import {
  updateAgentSettings,
  updateChildSettings,
  updateSessionSettings,
  listModels,
  refreshProviders,
} from '../lib/commands';
import { planChildModelUpdate, type ExactChildSettingsTarget } from '../lib/exactChildSettings';
import { effectiveProvider } from '../features/providers/providerDraft';
import {
  providerDefaultModel,
  providerModelCatalog,
  providerModelSelection,
} from '../features/providers/providerIdentity';
import { defaultModelOf } from './ModelCatalogList';
import { categoryOf, categoryOptions, type ModelCategory } from './modelCategories';

/**
 * Everything a model picker popover needs from the store: the active harness's
 * catalog, the effective model/effort for its scope (chat session, draft agent
 * config, or exact child), and the update paths for each. Presentation —
 * layout, rows, effort control — stays with the popover.
 */
export default function useModelPicker({
  singleAgent,
  childTarget,
}: {
  singleAgent: boolean;
  childTarget?: ExactChildSettingsTarget;
}) {
  const dispatch = useStoreDispatch();
  const state = useStoreSelector((current) => {
    const activeSession = current.activeAppSessionId
      ? current.sessions[current.activeAppSessionId]
      : undefined;
    const activeSettings = activeSession
      ? displayedModelSettings(
          activeSession,
          current.pendingModelUpdates[activeSession.appSessionId],
        )
      : undefined;
    return {
      activeSessionAppSessionId: activeSession?.appSessionId,
      activeSessionModelId: activeSettings?.modelId,
      activeSessionReasoning: activeSettings?.reasoningEffort,
      agentConfig: current.agentConfig,
      harnessModels: current.harnessModels,
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

  const childMode = childTarget !== undefined;

  // A chat composer picks its harness here too: free choice on a new draft,
  // fixed once the session exists. Mission and child pickers have no say in it.
  const showHarness = singleAgent && !childMode;
  const harnessLocked = state.activeSessionAppSessionId !== undefined;

  // The harness selector disables harnesses on a stale status, so refresh as it
  // opens. A locked harness has nothing to choose, and a refresh re-probes every CLI.
  const refreshesHarnesses = showHarness && !harnessLocked;
  useEffect(() => {
    if (refreshesHarnesses) refreshProviders();
  }, [refreshesHarnesses]);

  const selectHarness = (provider: ProviderKind) => {
    if (harnessLocked || provider === state.provider) return;
    dispatch({ type: 'SET_DRAFT_PROVIDER', provider });
    // The catalog swaps with the harness; a stale filter would hide it.
    setQuery('');
    setCat('all');
  };

  const selectedAgent = childTarget?.role ?? agent;
  // The primary's default is its harness's; worker/validator are Mission Control's own.
  const cfg: HarnessModel =
    selectedAgent === 'primary'
      ? state.harnessModels[state.provider]
      : state.agentConfig[selectedAgent];

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
  const disabled = Boolean(childTarget && !childReady);

  const source = providerModelCatalog(state.provider, state.models, state.providerStatuses);
  const hasRealModels = source.length > 0;
  // A provider that publishes no reasoning efforts has nothing to offer per row:
  // the effort control would be inert and the word beside it a Droid effort. A
  // ready provider whose catalog has not arrived has not answered yet, so the
  // control stays; one that cannot run has no efforts to offer at all.
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

  const catOptions = useMemo(() => categoryOptions(source, cat), [source, cat]);

  const models = useMemo(() => {
    const q = query.trim().toLowerCase();
    return source.filter((m) => {
      if (cat !== 'all' && categoryOf(m) !== cat) return false;
      if (!q) return true;
      return m.displayName.toLowerCase().includes(q) || m.id.toLowerCase().includes(q);
    });
  }, [source, query, cat]);

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
  // With no model of its own the chat runs on its default, so the list marks that row.
  const selectedRowId = resolvedModelId ?? defaultModel?.id;
  if (!childTarget && !scopedAppSessionId) effReasoning = draftEffortFor(activeModel, effReasoning);

  const updateSession = useCallback(
    (appSessionId: string, settings: PendingModelSettings) => {
      const requestId = crypto.randomUUID();
      dispatch({ type: 'MODEL_UPDATE_REQUESTED', appSessionId, requestId, settings });
      updateSessionSettings({ appSessionId, requestId, ...settings });
    },
    [dispatch],
  );

  const saveDefault = useCallback(
    (next: HarnessModel) => {
      if (agent === 'primary') {
        dispatch({ type: 'SET_HARNESS_MODEL', provider: state.provider, model: next });
        return;
      }
      dispatch({ type: 'SET_AGENT_MODEL', agent, modelId: next.modelId });
      if (next.reasoning)
        dispatch({ type: 'SET_AGENT_REASONING', agent, reasoning: next.reasoning });
    },
    [agent, dispatch, state.provider],
  );

  const updateReasoning = useCallback(
    (reasoning: ReasoningEffort) => {
      if (childTarget) return;
      if (scopedAppSessionId) {
        updateSession(scopedAppSessionId, { reasoningEffort: reasoning });
        return;
      }
      saveDefault({ modelId: cfg.modelId, reasoning });
      updateAgentSettings({
        appSessionId: state.activeSessionAppSessionId,
        agent,
        reasoningEffort: reasoning,
      });
    },
    [
      agent,
      cfg.modelId,
      childTarget,
      saveDefault,
      scopedAppSessionId,
      state.activeSessionAppSessionId,
      updateSession,
    ],
  );

  const updateModel = useCallback(
    (modelId: string) => {
      if (childTarget) {
        const update = planChildModelUpdate(childTarget, modelId, effReasoning, source);
        if (update) updateChildSettings(update);
        return;
      }

      // Snap only an explicit effort, as part of the same user-requested update.
      const next = source.find((x) => x.id === modelId);
      const reasoningEffort = reasoningForModelSwitch(next, effReasoning);
      const settings = {
        modelId,
        ...(reasoningEffort === undefined ? {} : { reasoningEffort }),
      };
      if (scopedAppSessionId) {
        updateSession(scopedAppSessionId, settings);
        return;
      }
      saveDefault({ modelId, reasoning: reasoningAfterModelSwitch(next, cfg.reasoning) });
      updateAgentSettings({ appSessionId: state.activeSessionAppSessionId, agent, ...settings });
    },
    [
      agent,
      cfg.reasoning,
      childTarget,
      effReasoning,
      saveDefault,
      scopedAppSessionId,
      source,
      state.activeSessionAppSessionId,
      updateSession,
    ],
  );

  return {
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
    provider: state.provider,
    providerStatuses: state.providerStatuses,
    showHarness,
    harnessLocked,
    selectHarness,
    childMode,
    childReady,
    disabled,
    models,
    hasRealModels,
    showsReasoning,
    resolvedModelId,
    selectedRowId,
    selectedLabel,
    activeModel,
    effReasoning,
    updateModel,
    updateReasoning,
  };
}
