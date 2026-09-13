import { PROVIDER_KINDS, type ProviderKind } from '../../types/bridge';

// The provider the next new session is created on. Sticky: the last pick is
// what the composer offers on the next chat and after a restart.
const STORAGE_KEY = 'droid-draft-provider';
const FIRST_RUN_DRAFT_PROVIDER: ProviderKind = 'droid';

function getLocalStorage(): Storage | undefined {
  if (typeof window !== 'undefined') return window.localStorage;
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
  return descriptor && 'value' in descriptor ? (descriptor.value as Storage) : undefined;
}

function normalizeProvider(value: unknown): ProviderKind | undefined {
  return PROVIDER_KINDS.find((kind) => kind === value);
}

export function loadDraftProvider(): ProviderKind {
  try {
    return normalizeProvider(getLocalStorage()?.getItem(STORAGE_KEY)) ?? FIRST_RUN_DRAFT_PROVIDER;
  } catch {
    return FIRST_RUN_DRAFT_PROVIDER;
  }
}

export function saveDraftProvider(provider: ProviderKind): void {
  try {
    getLocalStorage()?.setItem(STORAGE_KEY, provider);
  } catch {
    /* ignore */
  }
}
