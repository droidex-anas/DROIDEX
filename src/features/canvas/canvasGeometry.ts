// The board's one world-to-screen transform and the pure math every gesture on
// it runs through: pan, pointer-anchored zoom, Fit and focus, the rect
// arithmetic a drag or resize commits, align and distribute, and the two
// queries that ask which frames a screen box covers. There is no second
// coordinate system — a screen point is measured in the board element's own
// box, a world point is in canvas units, and `Viewport` is the only thing that
// relates them. The keyboard nudge is here too: it is the same rect arithmetic
// reached by a key instead of a hand.

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

/** Screen pixels of zoom delta that double the scale, roughly. */
const ZOOM_RATE_PX = 240;
/**
 * The largest delta one zoom event is read for. A mouse notch arrives as ±100
 * or more and a trackpad pinch as a handful of fractional pixels; clamping the
 * step is what lets one rate serve both without a device guess.
 */
const MAX_ZOOM_DELTA_PX = 48;

/** The smallest frame a resize may leave: narrower than this is not a design. */
export const MIN_FRAME_PX = 120;
/** Mirrors the sidecar's `maxFrameDimensionPx`, which rejects anything larger. */
export const MAX_FRAME_PX = 8192;

function clampScale(scale: number): number {
  return Math.min(MAX_SCALE, Math.max(MIN_SCALE, scale));
}

function clampDimension(px: number): number {
  return Math.min(MAX_FRAME_PX, Math.max(MIN_FRAME_PX, px));
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

/** Moves the board by a screen-pixel delta, which never changes the scale. */
export function panBy(viewport: Viewport, screenDelta: Point): Viewport {
  return { ...viewport, x: viewport.x + screenDelta.x, y: viewport.y + screenDelta.y };
}

/**
 * The scale one zoom event asks for. The rate is exponential and the clamp is
 * symmetric, so zooming out and back in over the same deltas returns to the
 * scale it started from.
 */
export function wheelZoomScale(scale: number, deltaY: number): number {
  const read = Math.min(MAX_ZOOM_DELTA_PX, Math.max(-MAX_ZOOM_DELTA_PX, deltaY));
  return scale * Math.exp(-read / ZOOM_RATE_PX);
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
function boundsOf(rects: readonly FrameRect[]): FrameRect | null {
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

/** What the hand took hold of: the whole frame, or one of its resize edges. */
export type FrameHandle = 'move' | 'east' | 'south' | 'southeast';

/**
 * A held frame's rect after the pointer moved `screenDelta` screen pixels,
 * which is `screenDelta / scale` world units, so the frame keeps up with the
 * hand at any zoom. A resize changes the frame's viewport dimensions, which is
 * what makes a responsive layout real (spec §4).
 */
export function applyFrameHandle(
  rect: FrameRect,
  handle: FrameHandle,
  screenDelta: Point,
  scale: number,
): FrameRect {
  const world = { x: screenDelta.x / scale, y: screenDelta.y / scale };
  if (handle === 'move') return { ...rect, x: rect.x + world.x, y: rect.y + world.y };
  return {
    ...rect,
    width: handle === 'south' ? rect.width : clampDimension(rect.width + world.x),
    height: handle === 'east' ? rect.height : clampDimension(rect.height + world.y),
  };
}

/** World units one arrow key moves a selection, and with Shift held (spec §4). */
const NUDGE_PX = 1;
const NUDGE_COARSE_PX = 10;

const ARROW_DIRECTION: Record<string, Point | undefined> = {
  ArrowLeft: { x: -1, y: 0 },
  ArrowRight: { x: 1, y: 0 },
  ArrowUp: { x: 0, y: -1 },
  ArrowDown: { x: 0, y: 1 },
};

/**
 * The world-unit step an arrow key nudges a selection by, or null when the key
 * is not one. The step is in world units rather than screen pixels: a nudge is
 * a layout edit, so it has to mean the same thing at every zoom.
 */
export function nudgeStep(key: string, coarse: boolean): Point | null {
  const direction = ARROW_DIRECTION[key];
  if (!direction) return null;
  const step = coarse ? NUDGE_COARSE_PX : NUDGE_PX;
  return { x: direction.x * step, y: direction.y * step };
}

/** One frame under the hand. Nothing here is written to layout until release. */
export interface FrameDrag {
  designId: string;
  pointerId: number;
  handle: FrameHandle;
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
 * One step of a frame drag or resize. Moving never commits; releasing commits
 * once and ends the gesture, so layout cannot be written twice for it; and
 * cancelling commits nothing, which leaves the snapshot's acknowledged rect as
 * the only thing the board can draw.
 */
export function reduceFrameDrag(
  drag: FrameDrag | null,
  event: FrameDragEvent,
): { drag: FrameDrag | null; commit: FrameRect | null } {
  if (drag === null || event.type === 'cancel') return { drag: null, commit: null };
  if (event.pointerId !== drag.pointerId) return { drag, commit: null };
  if (event.type === 'release')
    return { drag: null, commit: sameRect(drag.rect, drag.startRect) ? null : drag.rect };
  const screenDelta = { x: event.pointer.x - drag.origin.x, y: event.pointer.y - drag.origin.y };
  return {
    drag: {
      ...drag,
      rect: applyFrameHandle(drag.startRect, drag.handle, screenDelta, event.scale),
    },
    commit: null,
  };
}

/** Whether two rects are the same placement, which is what a commit asks. */
export function sameRect(left: FrameRect, right: FrameRect): boolean {
  return (
    left.x === right.x &&
    left.y === right.y &&
    left.width === right.width &&
    left.height === right.height
  );
}

/** The edge or axis an align brings a selection onto (spec §4). */
export type AlignEdge = 'left' | 'centerX' | 'right' | 'top' | 'centerY' | 'bottom';

/**
 * Aligns every rect to the selection's own bounds, returned in the order they
 * were given so a caller can zip them back with their design IDs. Align moves
 * frames; it never resizes them.
 */
export function alignRects(rects: readonly FrameRect[], edge: AlignEdge): FrameRect[] {
  const bounds = boundsOf(rects);
  if (!bounds) return [];
  return rects.map((rect) => {
    switch (edge) {
      case 'left':
        return { ...rect, x: bounds.x };
      case 'centerX':
        return { ...rect, x: bounds.x + (bounds.width - rect.width) / 2 };
      case 'right':
        return { ...rect, x: bounds.x + bounds.width - rect.width };
      case 'top':
        return { ...rect, y: bounds.y };
      case 'centerY':
        return { ...rect, y: bounds.y + (bounds.height - rect.height) / 2 };
      case 'bottom':
        return { ...rect, y: bounds.y + bounds.height - rect.height };
    }
  });
}

export type DistributeAxis = 'horizontal' | 'vertical';

/**
 * Spaces the rects between the outermost two so every gap is equal, which is
 * the only distribution that reads as even when the frames differ in size.
 * Fewer than three rects, or rects that already overflow their own bounds, are
 * returned unchanged.
 */
export function distributeRects(rects: readonly FrameRect[], axis: DistributeAxis): FrameRect[] {
  const spread = [...rects];
  if (spread.length < 3) return spread;
  const horizontal = axis === 'horizontal';
  const span = (rect: FrameRect) => (horizontal ? rect.width : rect.height);
  const start = (rect: FrameRect) => (horizontal ? rect.x : rect.y);

  const order = spread.map((_, index) => index).sort((a, b) => start(spread[a]) - start(spread[b]));
  const first = spread[order[0]];
  const last = spread[order[order.length - 1]];
  const covered = spread.reduce((total, rect) => total + span(rect), 0);
  const gap = (start(last) + span(last) - start(first) - covered) / (spread.length - 1);
  if (gap < 0) return spread;

  let edge = start(first);
  for (const index of order) {
    const rect = spread[index];
    spread[index] = horizontal ? { ...rect, x: edge } : { ...rect, y: edge };
    edge += span(rect) + gap;
  }
  return spread;
}

/** A frame as the board holds it, which is all the two queries below need. */
export interface PlacedFrame {
  designId: string;
  rect: FrameRect;
}

/**
 * The frames a rubber-band touches, in canvas order. The band is given by the
 * two screen points the hand drew it between, in either direction.
 */
export function framesInBand(
  frames: readonly PlacedFrame[],
  viewport: Viewport,
  from: Point,
  to: Point,
): string[] {
  const band = worldBounds(viewport, from, to);
  return frames.filter(({ rect }) => overlaps(rect, band)).map(({ designId }) => designId);
}

/**
 * The frames inside the board's own box, nearest its centre first. Only these
 * can take a live preview slot, and the order is how they compete for one.
 */
export function visibleDesignIds(
  frames: readonly PlacedFrame[],
  viewport: Viewport,
  viewportSize: Point,
): string[] {
  const box = worldBounds(viewport, { x: 0, y: 0 }, viewportSize);
  const centreX = box.x + box.width / 2;
  const centreY = box.y + box.height / 2;
  return frames
    .filter(({ rect }) => overlaps(rect, box))
    .map(({ designId, rect }) => ({
      designId,
      distance:
        Math.abs(rect.x + rect.width / 2 - centreX) + Math.abs(rect.y + rect.height / 2 - centreY),
    }))
    .sort((left, right) => left.distance - right.distance)
    .map(({ designId }) => designId);
}

/** Two screen points as world bounds, whatever order the hand drew them in. */
function worldBounds(viewport: Viewport, from: Point, to: Point): FrameRect {
  const a = screenToCanvas(viewport, from);
  const b = screenToCanvas(viewport, to);
  return {
    x: Math.min(a.x, b.x),
    y: Math.min(a.y, b.y),
    width: Math.abs(b.x - a.x),
    height: Math.abs(b.y - a.y),
  };
}

function overlaps(rect: FrameRect, bounds: FrameRect): boolean {
  return (
    rect.x < bounds.x + bounds.width &&
    rect.x + rect.width > bounds.x &&
    rect.y < bounds.y + bounds.height &&
    rect.y + rect.height > bounds.y
  );
}

/** One frame of a programmatic fit or focus (spec §11: 220 ms, eased). */
export function interpolateViewport(from: Viewport, to: Viewport, progress: number): Viewport {
  return {
    x: from.x + (to.x - from.x) * progress,
    y: from.y + (to.y - from.y) * progress,
    scale: from.scale + (to.scale - from.scale) * progress,
  };
}
