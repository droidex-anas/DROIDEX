import type { ProviderKind } from '../../types/bridge';

/**
 * Whether voice mode can run on a chat or on a draft that has not started yet.
 *
 * Only Codex implements a realtime voice thread (`ProviderVoice` in the
 * sidecar), so voice is offered there and nowhere else. A harness with no voice
 * hides the control instead of showing one that cannot connect.
 */
export function canUseVoice(provider: ProviderKind | null | undefined): boolean {
  return provider === 'codex';
}
