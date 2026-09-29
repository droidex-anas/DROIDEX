import type { ContextWindowTokens, ReasoningEffort, SessionSummary } from '../types/bridge';

/**
 * A chat's model, effort, fast mode or window change, shown before the sidecar
 * confirms it. `null` clears the model or effort back to the provider's default.
 */
export interface PendingModelSettings {
  modelId?: string | null;
  reasoningEffort?: ReasoningEffort | null;
  fastMode?: boolean;
  contextWindowTokens?: ContextWindowTokens;
}

/**
 * Every change requested since the chat last settled, merged. It is held until
 * the sidecar settles the latest request: settling on an earlier one would
 * flash its value while a quick follow-up (arrow keys, the effort slider) is
 * still in flight.
 */
export interface PendingModelUpdate {
  requestId: string;
  settings: PendingModelSettings;
}

type ModelSettings = Pick<SessionSummary, 'modelId' | 'reasoningEffort'>;

export function mergePendingModelSettings(
  previous: PendingModelSettings | undefined,
  next: PendingModelSettings,
): PendingModelSettings {
  return {
    ...previous,
    ...(next.modelId !== undefined ? { modelId: next.modelId } : {}),
    ...(next.reasoningEffort !== undefined ? { reasoningEffort: next.reasoningEffort } : {}),
    ...(next.fastMode !== undefined ? { fastMode: next.fastMode } : {}),
    ...(next.contextWindowTokens !== undefined
      ? { contextWindowTokens: next.contextWindowTokens }
      : {}),
  };
}

export function displayedModelSettings(
  summary: ModelSettings,
  pending: PendingModelUpdate | undefined,
): ModelSettings {
  if (!pending) return { modelId: summary.modelId, reasoningEffort: summary.reasoningEffort };
  const { modelId, reasoningEffort } = pending.settings;
  return {
    modelId: modelId === undefined ? summary.modelId : (modelId ?? undefined),
    reasoningEffort:
      reasoningEffort === undefined ? summary.reasoningEffort : (reasoningEffort ?? undefined),
  };
}
