// Agent inspect screenshots. The sidecar holds no pixels: it asks the renderer
// pages watching a canvas to capture one exact revision through their live
// preview's capture operation, and relays the first PNG, still base64, to the tool call.

import { randomUUID } from 'node:crypto';
import { imageMediaType } from './canvasAssets.js';
import { canvasError, type CanvasCommandError, EXPIRED_TURN } from './canvasError.js';
import type { CanvasCommand, CanvasEvent, RevisionRef } from './protocol.js';

/** The renderer's six-second capture deadline plus the bridge round trip. */
const CAPTURE_WAIT_MS = 7_000;
/** Main refuses a PNG above 8 MiB, so a longer relay is not one of its captures. */
export const MAX_CAPTURE_BASE64_LENGTH = Math.ceil((8 * 1024 * 1024) / 3) * 4;
const MAX_WAITING = 8;

const NOT_OPEN =
  'Open this design’s canvas in DROIDEX to capture it; no DROIDEX window is showing it.';
const TIMED_OUT = 'DROIDEX did not capture this design in time. Keep it open and try again.';
const BUSY = 'Too many design captures are waiting. Try again in a moment.';
const UNREADABLE = 'The DROIDEX window sent a capture that is not a PNG. Try again.';
const LEFT = 'The DROIDEX window showing this design closed before it captured it.';

interface WaitingCapture {
  /** The pages that were watching when it was asked and have not answered. */
  pages: Set<string>;
  refusal: string;
  settle: (result: string | CanvasCommandError) => void;
}

export type CanvasCapture = (
  canvasId: string,
  ref: RevisionRef,
  signal: AbortSignal,
) => Promise<string>;

export class CanvasCaptures {
  private readonly waiting = new Map<string, WaitingCapture>();

  constructor(
    private readonly emit: (event: CanvasEvent) => void,
    private readonly watchingPages: (canvasId: string) => string[],
  ) {}

  /** The base64 PNG of exactly this revision, or `capture_unavailable` saying why not. */
  capture(canvasId: string, ref: RevisionRef, signal: AbortSignal): Promise<string> {
    if (signal.aborted) return Promise.reject(canvasError('scope_expired', EXPIRED_TURN));
    const pages = new Set(this.watchingPages(canvasId));
    if (pages.size === 0) return Promise.reject(canvasError('capture_unavailable', NOT_OPEN));
    if (this.waiting.size >= MAX_WAITING)
      return Promise.reject(canvasError('capture_unavailable', BUSY));
    const captureId = randomUUID();
    return new Promise((resolve, reject) => {
      const settle = (result: string | CanvasCommandError) => {
        if (this.waiting.get(captureId)?.settle !== settle) return;
        this.waiting.delete(captureId);
        clearTimeout(timer);
        signal.removeEventListener('abort', abort);
        if (typeof result === 'string') resolve(result);
        else reject(result);
      };
      const abort = () => {
        settle(canvasError('scope_expired', EXPIRED_TURN));
      };
      const timer = setTimeout(() => {
        settle(canvasError('capture_unavailable', TIMED_OUT));
      }, CAPTURE_WAIT_MS);
      this.waiting.set(captureId, { pages, refusal: NOT_OPEN, settle });
      signal.addEventListener('abort', abort, { once: true });
      this.emit({ type: 'canvas.captureRequest', captureId, canvasId, ...ref });
    });
  }

  /**
   * One page's answer. A capture counts only answers from the pages it is
   * waiting on; it fails once every one of them has refused or gone.
   */
  answer(
    report: Extract<CanvasCommand, { type: 'canvas.reportCapture' }>,
    pageId: string | null,
  ): void {
    const capture = this.waiting.get(report.captureId);
    if (pageId === null || !capture?.pages.delete(pageId)) return;
    if (report.capture.ok) {
      // The bridge schema bounds the length; twelve base64 characters hold the signature.
      const { png } = report.capture;
      if (imageMediaType(Buffer.from(png.slice(0, 12), 'base64')) === 'image/png') {
        capture.settle(png);
        return;
      }
      capture.refusal = UNREADABLE;
    } else capture.refusal = report.capture.message;
    if (capture.pages.size === 0)
      capture.settle(canvasError('capture_unavailable', capture.refusal));
  }

  /** A page that reloaded or closed will never answer. */
  forget(pageId: string): void {
    for (const capture of this.waiting.values()) {
      if (!capture.pages.delete(pageId)) continue;
      if (capture.refusal === NOT_OPEN) capture.refusal = LEFT;
      if (capture.pages.size === 0)
        capture.settle(canvasError('capture_unavailable', capture.refusal));
    }
  }
}
