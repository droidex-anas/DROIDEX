// The canvases Design mode lists and the canvas menu names.
// `canvas.list` is a read: it mints nothing and starts no compiler.

import { useEffect, useState } from 'react';
import { useStoreSelector } from '../../hooks/useStore';
import { canvasClient } from './canvasClient';
import { canvasMessage } from './client';
import type { CanvasSummary } from './protocol';

export type Canvases =
  | { status: 'loading' }
  | { status: 'listed'; summaries: CanvasSummary[] }
  | { status: 'failed'; message: string };

/**
 * Reads the list while `enabled`, and watches the sidecar's summary broadcasts
 * for as long as it stays on screen, so a canvas created or renamed elsewhere
 * appears without a polling loop. It reads again whenever the bridge connects,
 * which is what recovers a list that was asked for too early. The last answer
 * stays on screen through a refresh rather than blinking.
 */
export function useCanvases(enabled = true): { canvases: Canvases } {
  const [canvases, setCanvases] = useState<Canvases>({ status: 'loading' });
  const connection = useStoreSelector((current) => current.connection);

  useEffect(() => {
    if (!enabled) return;
    let active = true;
    const absorb = (summaries: CanvasSummary[]) => {
      if (active) setCanvases({ status: 'listed', summaries });
    };
    const stopWatching = canvasClient.subscribeSummaries(absorb);
    canvasClient
      .listCanvases()
      .then(absorb)
      .catch((error: unknown) => {
        if (active) setCanvases({ status: 'failed', message: canvasMessage(error) });
      });
    return () => {
      active = false;
      stopWatching();
    };
  }, [connection, enabled]);

  return { canvases };
}
