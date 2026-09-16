import { PROVIDER_KINDS, type ProviderKind, type ProviderStatus } from '../../types/bridge';

// The provider the next new session is created on. Sticky: the last pick is
// what the composer offers on the next chat and after a restart.
const STORAGE_KEY = 'droid-draft-provider';
const FALLBACK_PROVIDER: ProviderKind = 'droid';

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
    return normalizeProvider(getLocalStorage()?.getItem(STORAGE_KEY)) ?? FALLBACK_PROVIDER;
  } catch {
    return FALLBACK_PROVIDER;
  }
}

// The provider a new session is actually created on. A stored pick can name a
// provider this build cannot run — an older pick, a CLI that went away, a
// status that has not arrived yet — and Droid is the one that always can.
export function effectiveProvider(draft: ProviderKind, statuses: ProviderStatus[]): ProviderKind {
  const ready = statuses.some(
    (status) => status.provider === draft && status.readiness === 'ready',
  );
  return ready ? draft : FALLBACK_PROVIDER;
}

export function saveDraftProvider(provider: ProviderKind): void {
  try {
    getLocalStorage()?.setItem(STORAGE_KEY, provider);
  } catch {
    /* ignore */
  }
}
