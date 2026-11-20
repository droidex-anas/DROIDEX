import { useStoreSelector } from '../../hooks/useStore';
import type { ProviderKind } from '../../types/bridge';
import { effectiveProvider } from '../providers/providerDraft';

// The harness a new chat is created on, as the composer resolves it.
export function useDraftHarness(): ProviderKind {
  return useStoreSelector((state) =>
    effectiveProvider(state.draftProvider, state.providerStatuses),
  );
}
