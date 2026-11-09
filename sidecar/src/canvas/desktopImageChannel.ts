import { randomUUID } from 'node:crypto';
import type { BrowserChannelProcess } from '../browser/desktopBrowserChannel.js';
import { ownedAssetSchema } from './canvasAssets.js';
import { canvasError, EXPIRED_TURN } from './canvasError.js';
import type { OwnedAsset } from './protocol.js';

// Electron main decodes raster images, so an image an agent names in its
// project goes through the same importer as one the user picks: main reads and
// decodes the file, then saves it through the sidecar's private image route.
// A request is never resent; one still waiting when the channel closes, past
// its timeout, or after its turn ends fails, and a late answer is dropped.

/** Main's importer answers within its own 15 s route timeout, plus a decode. */
const IMPORT_TIMEOUT_MS = 20_000;
const UNAVAILABLE = 'Importing project images needs the DROIDEX desktop app.';
const NO_ANSWER = 'DROIDEX did not import that image in time. Try again.';

/** Saves the image at an absolute path as one of the canvas's assets. */
export type ImportProjectImage = (
  canvasId: string,
  filePath: string,
  signal: AbortSignal,
) => Promise<OwnedAsset>;

interface Waiting {
  settle: (result: OwnedAsset | Error) => void;
}

export function createDesktopImageChannel(
  channel: BrowserChannelProcess = process,
  timeoutMs = IMPORT_TIMEOUT_MS,
): ImportProjectImage {
  const waiting = new Map<string, Waiting>();

  channel.on('message', (message: unknown) => {
    const answer = importAnswer(message);
    if (answer) waiting.get(answer.id)?.settle(answer.result);
  });
  channel.on('disconnect', () => {
    for (const entry of [...waiting.values()])
      entry.settle(canvasError('storage_failed', UNAVAILABLE));
  });

  return (canvasId, filePath, signal) => {
    if (signal.aborted) return Promise.reject(canvasError('scope_expired', EXPIRED_TURN));
    const send = channel.send?.bind(channel);
    if (!send || !channel.connected)
      return Promise.reject(canvasError('storage_failed', UNAVAILABLE));
    const id = randomUUID();
    return new Promise((resolve, reject) => {
      const settle = (result: OwnedAsset | Error) => {
        if (waiting.get(id)?.settle !== settle) return;
        waiting.delete(id);
        clearTimeout(timer);
        signal.removeEventListener('abort', abort);
        if (result instanceof Error) reject(result);
        else resolve(result);
      };
      const abort = () => {
        settle(canvasError('scope_expired', EXPIRED_TURN));
      };
      const timer = setTimeout(() => {
        settle(canvasError('storage_failed', NO_ANSWER));
      }, timeoutMs);
      waiting.set(id, { settle });
      signal.addEventListener('abort', abort, { once: true });
      try {
        send({ type: 'canvas.importImage', id, canvasId, filePath }, (error) => {
          if (error) settle(canvasError('storage_failed', UNAVAILABLE));
        });
      } catch {
        settle(canvasError('storage_failed', UNAVAILABLE));
      }
    });
  };
}

/** Main's answer, its refusal kept only when it is one of the importer's own. */
function importAnswer(message: unknown): { id: string; result: OwnedAsset | Error } | null {
  if (!message || typeof message !== 'object') return null;
  const { type, id, result } = message as Record<string, unknown>;
  if (type !== 'canvas.importImageResult' || typeof id !== 'string') return null;
  const answer = (result ?? {}) as Record<string, unknown>;
  if (answer.ok === true) {
    const asset = ownedAssetSchema.safeParse(answer.asset);
    return {
      id,
      result: asset.success ? asset.data : canvasError('storage_failed', UNAVAILABLE),
    };
  }
  const error = (answer.error ?? {}) as Record<string, unknown>;
  const code = error.code === 'invalid_input' ? 'invalid_input' : 'storage_failed';
  const text = typeof error.message === 'string' ? error.message.slice(0, 300) : UNAVAILABLE;
  return { id, result: canvasError(code, text) };
}
