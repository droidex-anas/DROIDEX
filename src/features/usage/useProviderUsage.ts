import { useEffect } from 'react';

import { useStoreSelector } from '../../hooks/useStore';
import { bridge } from '../../lib/bridge';
import type { ProviderKind, ProviderUsage } from '../../types/bridge';

// While /usage is open it asks again on the sidecar's own light cadence.
const PANEL_REFRESH_MS = 5 * 60_000;

// Who is looking: /usage itself, or a chat whose warning line reads the pace.
export type UsageWatch = 'panel' | 'chat';

// `immediate` is for the user's own asks: opening /usage and its Refresh. Never
// queued while the bridge is down: by the time it is back, /usage may be closed.
export function refreshUsage(
  provider: ProviderKind,
  panelOpen: boolean,
  immediate: boolean,
): boolean {
  return bridge.sendIfConnected({ type: 'usage.refresh', provider, panelOpen, immediate });
}

// A harness account's usage. While watched it is asked for when the watch
// starts or the bridge comes back, whenever the window comes back into focus,
// and every few minutes while /usage shows it; the sidecar's pushes and
// after-turn reads arrive on their own.
export function useProviderUsage(
  provider: ProviderKind,
  watch: UsageWatch | null,
  connected: boolean,
): ProviderUsage | undefined {
  const usage = useStoreSelector((state) => state.usage[provider]);
  useEffect(() => {
    if (!watch || !connected) return;
    const panelOpen = watch === 'panel';
    refreshUsage(provider, panelOpen, panelOpen);
    const again = () => {
      refreshUsage(provider, panelOpen, false);
    };
    window.addEventListener('focus', again);
    const timer = panelOpen ? setInterval(again, PANEL_REFRESH_MS) : undefined;
    return () => {
      window.removeEventListener('focus', again);
      clearInterval(timer);
    };
  }, [provider, watch, connected]);
  return usage;
}
