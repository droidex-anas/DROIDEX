import {
  cancelCanvasPreviewCapture,
  captureCanvasPreview,
  saveCanvasImage,
} from '../../lib/desktop';
import type { CanvasErrorCode, RevisionRef } from './protocol';

const CAPTURE_DEADLINE_MS = 6_000;
const UNAVAILABLE = 'This design could not be captured. Keep its preview open and try again.';

export class CanvasImageError extends Error {
  constructor(
    message = UNAVAILABLE,
    readonly code: CanvasErrorCode = 'capture_unavailable',
  ) {
    super(message);
    this.name = 'CanvasImageError';
  }
}

interface LivePreview {
  guestId: number;
  generation: number;
  width: number;
  height: number;
  scaleFactor: number;
  ended: AbortController;
}

const livePreviews = new Map<string, LivePreview>();

function captureKey(canvasId: string, ref: RevisionRef): string {
  return JSON.stringify([canvasId, ref.designId, ref.revisionId]);
}

/** The board calls this only after that guest reports ready; release cancels its captures. */
export function registerCanvasPreview(
  canvasId: string,
  ref: RevisionRef,
  preview: Omit<LivePreview, 'ended'>,
): () => void {
  const key = captureKey(canvasId, ref);
  livePreviews.get(key)?.ended.abort();
  const live = { ...preview, ended: new AbortController() };
  livePreviews.set(key, live);
  return () => {
    if (livePreviews.get(key) !== live) return;
    livePreviews.delete(key);
    live.ended.abort();
  };
}

/** Captures the mounted revision, independently of any source write or turn. */
export function captureCanvasImage(
  canvasId: string,
  ref: RevisionRef,
  signal: AbortSignal,
): Promise<{ mediaType: 'image/png'; bytes: Uint8Array }> {
  const key = captureKey(canvasId, ref);
  const preview = livePreviews.get(key);
  if (!preview || signal.aborted || preview.ended.signal.aborted)
    return Promise.reject(new CanvasImageError());

  const requestId = crypto.randomUUID();
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (result: { mediaType: 'image/png'; bytes: Uint8Array } | CanvasImageError) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      signal.removeEventListener('abort', cancel);
      preview.ended.signal.removeEventListener('abort', cancel);
      if (result instanceof CanvasImageError) reject(result);
      else resolve(result);
    };
    const cancel = () => {
      void cancelCanvasPreviewCapture(requestId).catch(() => undefined);
      finish(new CanvasImageError());
    };
    const timeout = setTimeout(() => {
      void cancelCanvasPreviewCapture(requestId).catch(() => undefined);
      finish(new CanvasImageError('Capturing this design took too long. Try again.'));
    }, CAPTURE_DEADLINE_MS);
    signal.addEventListener('abort', cancel, { once: true });
    preview.ended.signal.addEventListener('abort', cancel, { once: true });
    if (signal.aborted || preview.ended.signal.aborted) {
      cancel();
      return;
    }
    void captureCanvasPreview({
      requestId,
      guestId: preview.guestId,
      canvasId,
      designId: ref.designId,
      revisionId: ref.revisionId,
      generation: preview.generation,
      width: preview.width,
      height: preview.height,
      scaleFactor: preview.scaleFactor,
    }).then(
      (result) => {
        if (settled) return;
        if (livePreviews.get(key) !== preview) {
          cancel();
          return;
        }
        finish(result.ok ? result : new CanvasImageError(result.error.message));
      },
      () => {
        finish(new CanvasImageError());
      },
    );
  });
}

/** The OS dialog chooses the destination; generated code never supplies a path. */
export async function exportCanvasImage(
  canvasId: string,
  ref: RevisionRef,
  suggestedName: string,
  signal: AbortSignal,
): Promise<boolean> {
  await captureCanvasImage(canvasId, ref, signal);
  const saved = await saveCanvasImage(canvasId, ref.designId, ref.revisionId, suggestedName);
  if (saved.ok) return true;
  if ('cancelled' in saved) return false;
  throw new CanvasImageError(saved.message, saved.code);
}
