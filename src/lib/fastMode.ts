import type { ModelInfo, ProviderKind } from '../types/bridge';

// Fast mode is the speed-for-usage trade a harness offers on a chat. It is the
// mode the app asked for, never a claim about the speed actually delivered, so
// every surface says the same two things and nothing more.

export const FAST_MODE_LABEL = 'Fast mode';
export const FAST_MODE_HINT = '1.5x speed · More usage';

/** Droid's runtime has no fast mode, so its chats are never offered one. */
export function offersFastMode(provider: ProviderKind | undefined): boolean {
  return provider !== 'droid';
}

/**
 * Why this model cannot run fast, or undefined when it can. Only a catalog
 * that says `false` blocks it; a catalog that has not answered keeps the
 * control live rather than guessing.
 */
export function fastModeBlockedReason(
  model: Pick<ModelInfo, 'displayName' | 'supportsFastMode'> | undefined,
): string | undefined {
  if (model?.supportsFastMode !== false) return undefined;
  return `${model.displayName} has no fast mode`;
}
