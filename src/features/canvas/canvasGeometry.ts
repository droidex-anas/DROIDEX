// The board's one world-to-screen transform and the pure math every gesture on
// it runs through: pointer-anchored zoom, Fit and focus, and the frame drag's
// rect arithmetic. There is no second coordinate system — a screen point is
// measured in the board element's own box, a world point is in canvas units,
// and `Viewport` is the only thing that relates them.

import type { FrameRect } from './protocol';

export interface Point {
  x: number;
  y: number;
}

/** World units scaled by `scale`, then offset by `x`/`y`, in that order. */
export interface Viewport {
  x: number;
  y: number;
  scale: number;
}

export const MIN_SCALE = 0.1;
export const MAX_SCALE = 4;

/** Screen padding Fit and focus leave around what they frame. */
const FIT_PADDING_PX = 48;

/**
 * Fit never magnifies past 100%: one small frame focused into a wide pane should
 * read at its real size rather than being blown up to fill the board.
 */
const MAX_FIT_SCALE = 1;

/** Screen pixels of wheel delta that halve or double the scale, roughly. */
const WHEEL_RATE_PX = 400;
/** A trackpad pinch arrives as many small deltas, so it needs a finer rate. */
const PINCH_RATE_PX = 120;

export function clampScale(scale: number): number {
  return Math.min(MAX_SCALE, Math.max(MIN_SCALE, scale));
}

export function canvasToScreen(viewport: Viewport, point: Point): Point {
  return { x: point.x * viewport.scale + viewport.x, y: point.y * viewport.scale + viewport.y };
}

export function screenToCanvas(viewport: Viewport, point: Point): Point {
  return { x: (point.x - viewport.x) / viewport.scale, y: (point.y - viewport.y) / viewport.scale };
}

/** Zooms so that the world point under `point` is still under it afterwards. */
export function zoomAtPoint(viewport: Viewport, point: Point, requestedScale: number): Viewport {
  const scale = clampScale(requestedScale);
  const anchor = screenToCanvas(viewport, point);
  return { x: point.x - anchor.x * scale, y: point.y - anchor.y * scale, scale };
}

/**
 * The scale one wheel event asks for. Both rates are exponential, so zooming
 * out and back in over the same deltas returns to the scale it started from.
 */
export function wheelZoomScale(scale: number, deltaY: number, pinch: boolean): number {
  return scale * Math.exp(-deltaY / (pinch ? PINCH_RATE_PX : WHEEL_RATE_PX));
}

/**
 * The viewport that frames `rects` in a board of `viewportSize` screen pixels.
 * Fit passes every frame and focus passes one, so both land on this geometry.
 */
export function fitFrames(rects: FrameRect[], viewportSize: Point): Viewport {
  const bounds = boundsOf(rects);
  if (!bounds || viewportSize.x <= 0 || viewportSize.y <= 0) return { x: 0, y: 0, scale: 1 };
  const room = {
    x: Math.max(1, viewportSize.x - FIT_PADDING_PX * 2),
    y: Math.max(1, viewportSize.y - FIT_PADDING_PX * 2),
  };
  const scale = clampScale(Math.min(MAX_FIT_SCALE, room.x / bounds.width, room.y / bounds.height));
  return {
    x: viewportSize.x / 2 - (bounds.x + bounds.width / 2) * scale,
    y: viewportSize.y / 2 - (bounds.y + bounds.height / 2) * scale,
    scale,
  };
}

/** The box every rect sits inside, or null when there is nothing to frame. */
function boundsOf(rects: FrameRect[]): FrameRect | null {
  if (rects.length === 0) return null;
  let left = Infinity;
  let top = Infinity;
  let right = -Infinity;
  let bottom = -Infinity;
  for (const rect of rects) {
    left = Math.min(left, rect.x);
    top = Math.min(top, rect.y);
    right = Math.max(right, rect.x + rect.width);
    bottom = Math.max(bottom, rect.y + rect.height);
  }
  return { x: left, y: top, width: right - left, height: bottom - top };
}

/**
 * A dragged frame's rect. The pointer moved `screenDelta` screen pixels, which
 * is `screenDelta / scale` world units, so the frame keeps up with the hand at
 * any zoom.
 */
export function moveRect(rect: FrameRect, screenDelta: Point, scale: number): FrameRect {
  return { ...rect, x: rect.x + screenDelta.x / scale, y: rect.y + screenDelta.y / scale };
}

/** One frame under the hand. Nothing here is written to layout until release. */
export interface FrameDrag {
  designId: string;
  pointerId: number;
  /** The layout the gesture started from; a remote move since then rejects it. */
  expectedLayoutVersion: number;
  /** Where the pointer went down, in client pixels. */
  origin: Point;
  startRect: FrameRect;
  rect: FrameRect;
}

export type FrameDragEvent =
  | { type: 'move'; pointerId: number; pointer: Point; scale: number }
  | { type: 'release'; pointerId: number }
  | { type: 'cancel' };

/**
 * One step of a frame drag. Moving never commits; releasing commits once and
 * ends the gesture, so layout cannot be written twice for it; and cancelling
 * commits nothing, which leaves the snapshot's acknowledged rect as the only
 * thing the board can draw.
 */
export function reduceFrameDrag(
  drag: FrameDrag | null,
  event: FrameDragEvent,
): { drag: FrameDrag | null; commit: FrameRect | null } {
  if (drag === null || event.type === 'cancel') return { drag: null, commit: null };
  if (event.pointerId !== drag.pointerId) return { drag, commit: null };
  if (event.type === 'release') {
    const moved = drag.rect.x !== drag.startRect.x || drag.rect.y !== drag.startRect.y;
    return { drag: null, commit: moved ? drag.rect : null };
  }
  const screenDelta = { x: event.pointer.x - drag.origin.x, y: event.pointer.y - drag.origin.y };
  return {
    drag: { ...drag, rect: moveRect(drag.startRect, screenDelta, event.scale) },
    commit: null,
  };
}

/** One frame of a programmatic fit or focus (spec §11: 220 ms, eased). */
export function interpolateViewport(from: Viewport, to: Viewport, progress: number): Viewport {
  return {
    x: from.x + (to.x - from.x) * progress,
    y: from.y + (to.y - from.y) * progress,
    scale: from.scale + (to.scale - from.scale) * progress,
  };
}
