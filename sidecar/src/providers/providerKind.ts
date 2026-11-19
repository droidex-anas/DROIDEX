import { PROVIDER_KINDS, type ProviderKind } from '@droidex/protocol';

export const DEFAULT_PROVIDER: ProviderKind = 'droid';

// Lenient reader for persisted data: a stored session file written by an older
// or newer build may carry anything, and an unrecognized binding reads as absent.
export function providerKind(value: unknown): ProviderKind | undefined {
  return PROVIDER_KINDS.find((kind) => kind === value);
}

// session.create may omit the binding, but a provider this build cannot route is
// a caller bug: fail the create instead of quietly running on Droid.
export function requireProviderKind(value: unknown): ProviderKind {
  if (value === undefined) return DEFAULT_PROVIDER;
  const provider = providerKind(value);
  if (provider) return provider;
  const description = typeof value === 'string' ? value : typeof value;
  throw new Error(`Unsupported session provider: ${description}`);
}

export function assertProviderUnchanged(settings: object): void {
  if ('provider' in settings) {
    throw new Error('A session provider is chosen at creation and cannot be changed.');
  }
}
