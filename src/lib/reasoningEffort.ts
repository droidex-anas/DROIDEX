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

// Shared rule for the reasoning effort shown next to a model (composer badge
// and context-panel pill): the session's pinned effort wins and the global
// default is the fallback.
export function resolveReasoningEffortDisplay(
  sessionEffort: ReasoningEffort | undefined,
  globalDefault: ReasoningEffort | undefined,
  model: Pick<ModelInfo, 'supportedReasoningEfforts'> | undefined,
): ReasoningEffort | undefined {
  if (!offersReasoningEffort(model)) return undefined;
  return sessionEffort ?? globalDefault;
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
