// The one Canvas client the renderer uses. Subscriptions and in-flight requests
// are per client, so the pane, Design mode and the chat bootstrap share this one
// rather than each opening its own view of the same canvases.

import { bridge } from '../../lib/bridge';
import { CanvasClient } from './client';
import type { PreviewReport } from './protocol';

export const canvasClient = new CanvasClient(bridge);

/**
 * Tells the sidecar what a mounted preview did, so the agent hears about a
 * design that built and then stopped while rendering. Nothing waits on the
 * reply: a report lost to a disconnect costs the agent only its confirmation.
 */
export function reportPreview(canvasId: string, report: PreviewReport): void {
  bridge.sendIfConnected({
    type: 'canvas.reportPreview',
    requestId: crypto.randomUUID(),
    canvasId,
    report,
  });
}
