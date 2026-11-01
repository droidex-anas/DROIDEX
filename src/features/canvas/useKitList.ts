// The kits as the sidecar lists them, for the picker and the transcript's kit
// chips: read once connected, and again on request and on every kit change.
// A new reader starts from the last list, so a chip that scrolls back into
// view shows its kit at once instead of loading it again.

import { useCallback, useEffect, useState } from 'react';
import { useStoreSelector } from '../../hooks/useStore';
import { canvasClient } from './canvasClient';
import { canvasMessage } from './client';
import { followLatest } from './designSystemChoices';
import type { KitList } from './designSystemsState';
import type { DesignSystemSummary } from './protocol';

let lastListed: DesignSystemSummary[] | null = null;

/**
 * The kits, to name a pinned frame's kit and notice a deleted one. Each read
 * moves the canvases' choices to their kits' latest versions.
 */
export function useKitList(): { list: KitList; reread: () => void; retry: () => void } {
  const [list, setList] = useState<KitList>(() =>
    lastListed ? { status: 'listed', systems: lastListed } : { status: 'loading' },
  );
  const [reads, setReads] = useState(0);
  const isConnected = useStoreSelector((state) => state.connection === 'connected');

  useEffect(() => {
    if (!isConnected) return;
    let active = true;
    canvasClient.designSystems.list().then(
      (systems) => {
        if (!active) return;
        followLatest(systems);
        lastListed = systems;
        setList({ status: 'listed', systems });
      },
      (error: unknown) => {
        if (active) setList({ status: 'failed', message: canvasMessage(error) });
      },
    );
    return () => {
      active = false;
    };
  }, [reads, isConnected]);

  const reread = useCallback(() => {
    setReads((count) => count + 1);
  }, []);
  useEffect(() => canvasClient.subscribeDesignSystems(reread), [reread]);
  // A reread keeps the last list on screen; a retry shows the read again.
  const retry = () => {
    setList({ status: 'loading' });
    reread();
  };
  return { list, reread, retry };
}
