// Agent screenshots and renders. The sidecar holds no pixels: it asks the
// renderer pages watching a canvas to capture one exact revision through their
// live preview, and relays the first answer in the format it asked for, a PNG
// still base64 or a vector design's SVG, to the tool call.

import { randomUUID } from 'node:crypto';
import { imageMediaType } from './canvasAssets.js';
import { canvasError, type CanvasCommandError, EXPIRED_TURN } from './canvasError.js';
import type { CanvasCommand, CanvasEvent, CaptureImage, RevisionRef } from './protocol.js';

/** The renderer's six-second capture deadline plus the bridge round trip. */
const CAPTURE_WAIT_MS = 7_000;
/** Main refuses a PNG above 8 MiB, so a longer relay is not one of its captures. */
export const MAX_CAPTURE_BASE64_LENGTH = Math.ceil((8 * 1024 * 1024) / 3) * 4;
/** The preview reporter's cap on a vector design's markup. */
export const MAX_CAPTURE_SVG_BYTES = 256 * 1024;
const MAX_WAITING = 8;

const NOT_OPEN =
  'Open this design’s canvas in DROIDEX to capture it; no DROIDEX window is showing it.';
const TIMED_OUT = 'DROIDEX did not capture this design in time. Keep it open and try again.';
const BUSY = 'Too many design captures are waiting. Try again in a moment.';
const UNREADABLE = 'The DROIDEX window sent a capture in the wrong format. Try again.';
const LEFT = 'The DROIDEX window showing this design closed before it captured it.';

type CaptureReport = Extract<CanvasCommand, { type: 'canvas.reportCapture' }>;

interface WaitingCapture {
  /** The pages that were watching when it was asked and have not answered. */
  pages: Set<string>;
  format: CaptureImage['format'];
  refusal: string;
  settle: (result: string | CanvasCommandError) => void;
}

/** The base64 PNG, or the SVG markup when the image asked for is an SVG. */
export type CanvasCapture = (
  canvasId: string,
  ref: RevisionRef,
  signal: AbortSignal,
  image: CaptureImage,
) => Promise<string>;

export class CanvasCaptures {
  private readonly waiting = new Map<string, WaitingCapture>();

  constructor(
    private readonly emit: (event: CanvasEvent) => void,
    private readonly watchingPages: (canvasId: string) => string[],
  ) {}

  /** That image of exactly this revision, or `capture_unavailable` saying why not. */
  capture(
    canvasId: string,
    ref: RevisionRef,
    signal: AbortSignal,
    image: CaptureImage,
  ): Promise<string> {
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
      this.waiting.set(captureId, { pages, format: image.format, refusal: NOT_OPEN, settle });
      signal.addEventListener('abort', abort, { once: true });
      this.emit({ type: 'canvas.captureRequest', captureId, canvasId, ...ref, image });
    });
  }

  /**
   * One page's answer. A capture counts only answers from the pages it is
   * waiting on; it fails once every one of them has refused or gone.
   */
  answer(report: CaptureReport, pageId: string | null): void {
    const capture = this.waiting.get(report.captureId);
    if (pageId === null || !capture?.pages.delete(pageId)) return;
    const answered = report.capture;
    const image = answered.ok ? imageAsked(answered, capture.format) : null;
    if (image !== null) {
      capture.settle(image);
      return;
    }
    capture.refusal = answered.ok ? UNREADABLE : answered.message;
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

/**
 * The answer, when it is the format asked for. The bridge schema bounds both;
 * an SVG is sanitised by whoever writes it, and a PNG must carry its signature
 * and a whole IHDR chunk, which a render reads its pixel size from.
 */
function imageAsked(
  answered: Exclude<CaptureReport['capture'], { ok: false }>,
  format: CaptureImage['format'],
): string | null {
  if (format === 'svg') return 'svg' in answered ? answered.svg : null;
  if (!('png' in answered)) return null;
  // Forty-four base64 characters hold the signature and the IHDR chunk.
  const head = Buffer.from(answered.png.slice(0, 44), 'base64');
  const isPng =
    head.length === 33 &&
    imageMediaType(head) === 'image/png' &&
    head.readUInt32BE(8) === 13 &&
    head.toString('ascii', 12, 16) === 'IHDR' &&
    head.readUInt32BE(16) > 0 &&
    head.readUInt32BE(20) > 0;
  return isPng ? answered.png : null;
}
