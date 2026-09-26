import type { ContextWindowTokens, ModelInfo, ProviderKind } from '../types/bridge';

// The context window is a per-chat preference distinct from the window the
// chat is measured against: picking none leaves the provider's own in place.

export const CONTEXT_WINDOW_LABEL = 'Context window';
export const CONTEXT_WINDOWS: readonly ContextWindowTokens[] = [200000, 1000000];

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
