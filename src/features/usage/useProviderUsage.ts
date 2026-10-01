import { useEffect, useSyncExternalStore } from 'react';

import { bridge } from '../../lib/bridge';
import type { ProviderKind, ProviderUsage, ServerEvent } from '../../types/bridge';

// While /usage is open it asks again on the sidecar's own light cadence.
const PANEL_REFRESH_MS = 5 * 60_000;

// Who is looking: /usage itself, or a chat whose warning line reads the pace.
export type UsageWatch = 'panel' | 'chat';

// One account per harness, shared by every composer that shows it.
const usageByProvider = new Map<ProviderKind, ProviderUsage>();
const listeners = new Set<() => void>();
let listening = false;

function subscribe(listener: () => void): () => void {
  if (!listening) {
    listening = true;
    bridge.subscribe(receive);
  }
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function receive(event: ServerEvent): void {
  if (event.type !== 'usage.updated') return;
  usageByProvider.set(event.usage.provider, event.usage);
  for (const listener of listeners) listener();
}

// `immediate` is for the user's own asks: opening /usage and its Refresh.
export function refreshUsage(provider: ProviderKind, panelOpen: boolean, immediate: boolean): void {
  bridge.send({ type: 'usage.refresh', provider, panelOpen, immediate });
}

// A harness account's usage. While watched it is asked for when the watch
// starts and whenever the window comes back into focus, and every few minutes
// while /usage shows it; the sidecar's pushes and after-turn reads arrive on
// their own.
export function useProviderUsage(
  provider: ProviderKind,
  watch: UsageWatch | null,
): ProviderUsage | undefined {
  const usage = useSyncExternalStore(subscribe, () => usageByProvider.get(provider));
  useEffect(() => {
    if (!watch) return;
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
  }, [provider, watch]);
  return usage;
}
