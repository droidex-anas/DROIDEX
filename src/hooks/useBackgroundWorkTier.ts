import { useEffect, useRef } from 'react';

import { useDocumentVisible } from './useDocumentVisible';
import { useStoreDispatch, useStoreSelector } from './useStore';
import { chatsOnScreen, sameEntries } from '../features/tabs/tabStrip';
import { setBackgroundWork } from '../lib/commands';
import { resolveBackgroundWorkTier, type BackgroundWorkTier } from '../lib/backgroundWork';
import { desktopPowerTier, onDesktopMemoryPressure, onDesktopPowerTier } from '../lib/desktop';

interface SentBackgroundWork {
  tier: BackgroundWorkTier;
  focused: string | null;
  visible: string[];
}

export function useBackgroundWorkTier(): void {
  const documentVisible = useDocumentVisible();
  const focusedAppSessionId = useStoreSelector((state) => state.activeAppSessionId);
  const visibleAppSessionIds = useStoreSelector(chatsOnScreen, sameEntries);
  const connected = useStoreSelector((state) => state.connection === 'connected');
  const dispatch = useStoreDispatch();
  const lastSent = useRef<SentBackgroundWork | null>(null);

  useEffect(() => {
    if (!connected) {
      lastSent.current = null;
      return;
    }
    let disposed = false;
    let windowVisible = true;
    let onBattery = false;

    const publish = (tier: BackgroundWorkTier) => {
      const sent = lastSent.current;
      if (
        sent?.tier === tier &&
        sent.focused === focusedAppSessionId &&
        sameEntries(sent.visible, visibleAppSessionIds)
      ) {
        return;
      }
      lastSent.current = { tier, focused: focusedAppSessionId, visible: visibleAppSessionIds };
      setBackgroundWork(tier, focusedAppSessionId, visibleAppSessionIds);
    };

    const sync = () => {
      if (disposed) return;
      publish(resolveBackgroundWorkTier({ windowVisible, documentVisible, onBattery }));
    };

    void desktopPowerTier().then((snapshot) => {
      if (disposed || !snapshot) return;
      windowVisible = snapshot.windowVisible;
      onBattery = snapshot.onBattery;
      sync();
    });

    const stopPower = onDesktopPowerTier((snapshot) => {
      windowVisible = snapshot.windowVisible;
      onBattery = snapshot.onBattery;
      sync();
    });
    const stopPressure = onDesktopMemoryPressure(() => {
      dispatch({ type: 'MEMORY_PRESSURE' });
    });
    sync();

    return () => {
      disposed = true;
      stopPower();
      stopPressure();
    };
  }, [connected, dispatch, documentVisible, focusedAppSessionId, visibleAppSessionIds]);
}
