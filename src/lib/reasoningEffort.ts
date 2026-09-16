import type { ModelInfo, ProviderKind, ReasoningEffort } from '../types/bridge';

const REASONING_EFFORTS: Readonly<Record<ReasoningEffort, true>> = {
  off: true,
  none: true,
  minimal: true,
  low: true,
  medium: true,
  high: true,
  xhigh: true,
  max: true,
  ultra: true,
  dynamic: true,
};

export function isReasoningEffort(value: unknown): value is ReasoningEffort {
  return typeof value === 'string' && Object.hasOwn(REASONING_EFFORTS, value);
}

// Whether a model's harness offers a reasoning effort for it at all. A model
// known to publish none has no control to offer, in the picker or beside the
// model's name. An unknown model (list still loading) keeps the control so it
// does not flicker out and back in.
export function offersReasoningEffort(
  model: Pick<ModelInfo, 'supportedReasoningEfforts'> | undefined,
): boolean {
  return !model || (model.supportedReasoningEfforts?.length ?? 0) > 0;
}

// Callers choose the session or draft effort. An unset session effort stays
// provider-managed; display code must not substitute a global or catalog default.
export function resolveReasoningEffortDisplay(
  effort: ReasoningEffort | undefined,
  model: Pick<ModelInfo, 'supportedReasoningEfforts'> | undefined,
): ReasoningEffort | undefined {
  return offersReasoningEffort(model) ? effort : undefined;
}

export function compatibleReasoningForModel(
  model: ModelInfo | undefined,
  currentReasoning: ReasoningEffort | undefined,
): ReasoningEffort | undefined {
  if (!model || currentReasoning === undefined) return undefined;
  const supported = model.supportedReasoningEfforts;
  if (supported?.length)
    return supported.includes(currentReasoning)
      ? undefined
      : (model.defaultReasoningEffort ?? supported.at(-1));
  if (model.defaultReasoningEffort && currentReasoning !== model.defaultReasoningEffort)
    return model.defaultReasoningEffort;
  return undefined;
}

// The top rung is the same idea on both harnesses but not the same word: Claude
// Code calls it ultracode, Codex calls it Ultra. Every surface that names a
// level goes through here, so the chip, the picker rows, and the context panel
// always speak the harness's own vocabulary. Callers capitalize for display.
export function reasoningEffortLabel(
  effort: ReasoningEffort,
  provider: ProviderKind | undefined,
): string {
  if (effort !== 'ultra') return effort;
  return provider === 'claude' ? 'ultracode' : 'ultra';
}
