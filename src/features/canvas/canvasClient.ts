// The one Canvas client the renderer uses. Subscriptions and in-flight requests
// are per client, so the pane, Design mode and the chat bootstrap share this one
// rather than each opening its own view of the same canvases.

import { bridge } from '../../lib/bridge';
import { CanvasClient } from './client';

export const canvasClient = new CanvasClient(bridge);

/** The short recovery line a Canvas failure carries; never a stack trace. */
export function canvasMessage(error: unknown): string {
  return error instanceof Error && error.message
    ? error.message
    : 'Canvas could not finish that request.';
}
