// The one Canvas client the renderer uses. Subscriptions and in-flight requests
// are per client, so the pane, Design mode and the chat bootstrap share this one
// rather than each opening its own view of the same canvases.

import { bridge } from '../../lib/bridge';
import { answerCaptureRequest } from './captureCanvasImage';
import { CanvasClient } from './client';

export const canvasClient = new CanvasClient(bridge);

// Every page answers an agent's screenshot request; the sidecar counts only the
// pages watching that canvas, and a lost answer costs the agent only that capture.
bridge.subscribe((event) => {
  if (event.type !== 'canvas.captureRequest') return;
  void answerCaptureRequest(event).then((report) => bridge.sendIfConnected(report));
});
