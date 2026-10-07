// The canvases Design mode lists and the canvas menu names.
// `canvas.list` is a read: it mints nothing and starts no compiler.

import { useEffect, useState } from 'react';
import { canvasClient, canvasMessage } from './canvasClient';
import type { CanvasSummary } from './protocol';

export type Canvases =
  | { status: 'loading' }
  | { status: 'listed'; summaries: CanvasSummary[] }
  | { status: 'failed'; message: string };

/**
 * Reads the list while `enabled`, and again each time it turns back on, so a
 * menu that only needs it while open does not list on every pane render. The
 * last answer stays on screen through a refresh rather than blinking.
 */
export function useCanvases(enabled = true): { canvases: Canvases } {
  const [canvases, setCanvases] = useState<Canvases>({ status: 'loading' });

  useEffect(() => {
    if (!enabled) return;
    let active = true;
    canvasClient
      .listCanvases()
      .then((summaries) => {
        if (active) setCanvases({ status: 'listed', summaries });
      })
      .catch((error: unknown) => {
        if (active) setCanvases({ status: 'failed', message: canvasMessage(error) });
      });
    return () => {
      active = false;
    };
  }, [enabled]);

  return { canvases };
}
