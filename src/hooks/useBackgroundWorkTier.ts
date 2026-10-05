import { useEffect, useRef, useState } from 'react';

import { useDocumentVisible } from './useDocumentVisible';
import { useStoreDispatch, useStoreSelector } from './useStore';
import { chatsOnScreen, sameEntries } from '../features/tabs/tabStrip';
import { setBackgroundWork } from '../lib/commands';
import { resolveBackgroundWorkTier, type BackgroundWorkTier } from '../lib/backgroundWork';
import {
  desktopPowerTier,
  onDesktopMemoryPressure,
  onDesktopPowerTier,
  type DesktopPowerTierSnapshot,
} from '../lib/desktop';

interface SentBackgroundWork {
  tier: BackgroundWorkTier;
  focused: string | null;
  visible: string[];
}

type PowerState = Pick<DesktopPowerTierSnapshot, 'windowVisible' | 'onBattery'>;

const VISIBLE_ON_MAINS: PowerState = { windowVisible: true, onBattery: false };

export function useBackgroundWorkTier(): void {
  const documentVisible = useDocumentVisible();
  const activeAppSessionId = useStoreSelector((state) => state.activeAppSessionId);
  const visibleAppSessionIds = useStoreSelector(chatsOnScreen, sameEntries);
  const focusedAppSessionId =
    activeAppSessionId && visibleAppSessionIds.includes(activeAppSessionId)
      ? activeAppSessionId
      : null;
  const connected = useStoreSelector((state) => state.connection === 'connected');
  const dispatch = useStoreDispatch();
  const [power, setPower] = useState<PowerState>(VISIBLE_ON_MAINS);
  const lastSent = useRef<SentBackgroundWork | null>(null);

  // Subscribed apart from the chats on screen, which change with every tile gesture.
  useEffect(() => {
    if (!connected) return;
    let disposed = false;
    void desktopPowerTier().then((snapshot) => {
      if (!disposed && snapshot) setPower(snapshot);
    });
    const stopPower = onDesktopPowerTier(setPower);
    const stopPressure = onDesktopMemoryPressure(() => {
      dispatch({ type: 'MEMORY_PRESSURE' });
    });
    return () => {
      disposed = true;
      stopPower();
      stopPressure();
    };
  }, [connected, dispatch]);

  useEffect(() => {
    if (!connected) {
      lastSent.current = null;
      return;
    }
    const tier = resolveBackgroundWorkTier({
      windowVisible: power.windowVisible,
      documentVisible,
      onBattery: power.onBattery,
    });
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
  }, [connected, documentVisible, focusedAppSessionId, power, visibleAppSessionIds]);
}
