import type { ContextWindowTokens, ModelInfo, ProviderKind, ProviderStatus } from '../types/bridge';

// The context window is a per-chat preference distinct from the window the
// chat is measured against: picking none leaves the provider's own in place.

export const CONTEXT_WINDOW_LABEL = 'Context window';
const CONTEXT_WINDOWS: readonly ContextWindowTokens[] = [200000, 1000000];

export interface ContextWindowOption {
  value: ContextWindowTokens;
  label: string;
  /** The window the provider runs when the chat pins none. */
  isProviderDefault: boolean;
  /** Why this window cannot be picked, absent when it can. */
  unavailableReason?: string;
}

/** Only Claude Code lets a chat choose its window; the rest run the model's. */
export function offersContextWindow(provider: ProviderKind | undefined): boolean {
  return provider === 'claude';
}

/** A window in the app's own words: 200k, 1M. */
export function contextWindowLabel(tokens: number): string {
  return tokens >= 1000000
    ? `${String(tokens / 1000000)}M`
    : `${String(Math.round(tokens / 1000))}k`;
}

/**
 * The window a chat that pins none runs on: the one measured for it, or for a
 * draft on its harness's own default model, the one that default asks for.
 */
export function unpinnedContextWindow(
  measured: number | undefined,
  model: Pick<ModelInfo, 'id'> | undefined,
  status: Pick<ProviderStatus, 'defaultModelId' | 'defaultContextWindowTokens'> | undefined,
): number | undefined {
  if (measured !== undefined) return measured;
  return model?.id === status?.defaultModelId ? status?.defaultContextWindowTokens : undefined;
}

/**
 * The two windows as the menu offers them. A window the model's catalog puts
 * out of reach is offered disabled with that reason rather than hidden, so the
 * menu always shows the whole choice.
 */
export function contextWindowOptions(
  model: Pick<ModelInfo, 'displayName' | 'maxContextTokens'> | undefined,
  providerWindow: number | undefined,
): ContextWindowOption[] {
  const ceiling = model?.maxContextTokens;
  return CONTEXT_WINDOWS.map((value) => ({
    value,
    label: contextWindowLabel(value),
    isProviderDefault: providerWindow === value,
    ...(ceiling !== undefined && ceiling < value
      ? {
          unavailableReason: `${model?.displayName ?? 'This model'} runs a ${contextWindowLabel(ceiling)} window`,
        }
      : {}),
  }));
}

/**
 * The window a chat takes when it moves to `model`: the largest the model runs,
 * when the one it pinned is beyond it. Undefined when the pin still fits.
 */
export function contextWindowForModel(
  model: Pick<ModelInfo, 'maxContextTokens'> | undefined,
  pinned: ContextWindowTokens | undefined,
): ContextWindowTokens | undefined {
  const ceiling = model?.maxContextTokens;
  if (pinned === undefined || ceiling === undefined || pinned <= ceiling) return undefined;
  return CONTEXT_WINDOWS.filter((value) => value <= ceiling).at(-1);
}
