import type { ModelInfo, ProviderStatus, ReasoningEffort, SessionSummary } from '@droidex/protocol';
import { providerDefaultModel, providerModelCatalog } from './providerIdentity';
import { resolveReasoningEffortDisplay } from '../../lib/reasoningEffort';

// The model row in the chat's own provider terms: its provider's catalog names
// the model, and the model itself says whether its harness offers a reasoning
// effort to show.
export function sessionModelDisplay(
  session: SessionSummary | null,
  state: {
    models: ModelInfo[];
    providerStatuses: ProviderStatus[];
  },
): { modelInfo?: ModelInfo; modelLabel: string; reasoningEffort?: ReasoningEffort } {
  if (!session) return { modelLabel: 'default' };
  const catalog = providerModelCatalog(session.provider, state.models, state.providerStatuses);
  const pinned = session.modelId
    ? catalog.find((model) => model.id === session.modelId)
    : undefined;
  // A chat with no model of its own runs on its harness's configured default, so
  // the row names that model instead of the word "default".
  const shown =
    pinned ??
    (session.modelId
      ? undefined
      : providerDefaultModel(session.provider, catalog, state.providerStatuses));
  return {
    ...(shown ? { modelInfo: shown } : {}),
    modelLabel: shown?.displayName ?? session.modelId ?? 'default',
    reasoningEffort: resolveReasoningEffortDisplay(session.reasoningEffort, shown),
  };
}
