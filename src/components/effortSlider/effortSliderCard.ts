import type { CSSProperties } from 'react';
import { reasoningEffortLabel } from '../../lib/reasoningEffort';
import type { ProviderKind, ReasoningEffort } from '../../types/bridge';
import type { EffortSliderLevel } from './effortSliderElement';

// The card is already the surface, so the slider's own panel stays flat and
// fills the card at the app's type scale instead of scaling with its width.
export const CARD_SLIDER_STYLE = {
  '--effort-unit': '1px',
  '--effort-width': '100%',
  '--effort-padding': '8px 4px 4px',
  '--effort-surface': 'transparent',
  '--effort-border': 'transparent',
  '--effort-shadow': 'none',
  '--effort-text': 'var(--text)',
  '--effort-muted': 'var(--text-muted)',
  '--effort-rail': 'var(--active)',
  '--effort-tick': 'color-mix(in srgb, var(--text) 22%, transparent)',
  '--effort-fill': 'color-mix(in srgb, var(--text) 45%, transparent)',
  '--effort-accent': 'var(--ultra, #a392e5)',
} as CSSProperties;

// The slider speaks the chip's vocabulary (Xhigh, and the harness's own word
// for ultra: Ultracode on Claude, Ultra elsewhere).
function effortDisplay(effort: ReasoningEffort, provider: ProviderKind): string {
  const label = reasoningEffortLabel(effort, provider);
  return label.charAt(0).toUpperCase() + label.slice(1);
}

export function effortSliderLevels(
  efforts: readonly ReasoningEffort[],
  provider: ProviderKind,
): EffortSliderLevel[] {
  return efforts.map((effort) => ({ value: effort, label: effortDisplay(effort, provider) }));
}
