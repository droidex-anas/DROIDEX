// The pure arithmetic behind drawing on the board: what a drag with each tool
// makes, how a mark moves and resizes, the box a mark occupies, and the paths
// its strokes are drawn with. Everything is in board pixels; the layer's
// transform is what puts it on screen.

import type {
  Annotation,
  AnnotationDraft,
  AnnotationPoint,
  AnnotationRect,
} from './annotationProtocol';

/** What the next press on the board draws. */
export type AnnotationTool = 'draw' | 'rect' | 'ellipse' | 'line' | 'arrow' | 'text' | 'note';

export type ShapeTool = 'rect' | 'ellipse' | 'line' | 'arrow';

/** The corner of a box a resize drags, or the end of a line it moves. */
export type AnnotationHandle = 'nw' | 'ne' | 'sw' | 'se' | 'start' | 'end';

type BoxDraft = Extract<AnnotationDraft, { rect: AnnotationRect }>;
export type TextDraft = Extract<AnnotationDraft, { kind: 'text' | 'note' }>;

// Mirrors `ANNOTATION_LIMITS` in the sidecar's canvasAnnotationSchema.ts.
const MAX_COORDINATE = 10_000_000;
const MAX_DIMENSION = 65_536;
const MAX_DRAWN_POINTS = 2048;
export const MAX_TEXT_LENGTH = 2000;

/** The box a click with the text or note tool places, in screen pixels. */
const CLICKED_BOX_PX = { text: { width: 220, height: 28 }, note: { width: 200, height: 160 } };

export function isShapeTool(tool: AnnotationTool | null): tool is ShapeTool {
  return tool === 'rect' || tool === 'ellipse' || tool === 'line' || tool === 'arrow';
}

function isBoxDraft(draft: AnnotationDraft): draft is BoxDraft {
  return 'rect' in draft;
}

export function isTextDraft(draft: AnnotationDraft): draft is TextDraft {
  return draft.kind === 'text' || draft.kind === 'note';
}

/** The draft an annotation was saved from, without what the sidecar stamped on it. */
export function draftOf(annotation: Annotation): AnnotationDraft {
  const { id, color } = annotation;
  switch (annotation.kind) {
    case 'rect':
    case 'ellipse':
      return { id, color, kind: annotation.kind, rect: annotation.rect };
    case 'text':
    case 'note':
      return { id, color, kind: annotation.kind, rect: annotation.rect, text: annotation.text };
    case 'line':
      return {
        id,
        color,
        kind: 'line',
        points: annotation.points,
        arrowStart: annotation.arrowStart,
        arrowEnd: annotation.arrowEnd,
      };
    case 'path':
      return { id, color, kind: 'path', points: annotation.points };
  }
}

function coordinate(value: number): number {
  return Math.min(MAX_COORDINATE, Math.max(-MAX_COORDINATE, value));
}

function bounded(at: AnnotationPoint): AnnotationPoint {
  return { x: coordinate(at.x), y: coordinate(at.y) };
}

/** The box between two corners, whichever way it was dragged, never empty. */
export function boxBetween(from: AnnotationPoint, to: AnnotationPoint): AnnotationRect {
  return {
    x: coordinate(Math.min(from.x, to.x)),
    y: coordinate(Math.min(from.y, to.y)),
    width: Math.min(MAX_DIMENSION, Math.max(1, Math.abs(to.x - from.x))),
    height: Math.min(MAX_DIMENSION, Math.max(1, Math.abs(to.y - from.y))),
  };
}

/**
 * What a drag with a shape, text or note tool makes; `to` is null for a press
 * that never moved. Such a press makes no shape, but text and note place a box
 * of screen size there, whose text is typed before anything is saved.
 */
export function draggedDraft(
  tool: Exclude<AnnotationTool, 'draw'>,
  { id, color }: Pick<AnnotationDraft, 'id' | 'color'>,
  from: AnnotationPoint,
  to: AnnotationPoint | null,
  scale: number,
): AnnotationDraft | null {
  if (tool === 'text' || tool === 'note') {
    const clicked = CLICKED_BOX_PX[tool];
    const end = to ?? { x: from.x + clicked.width / scale, y: from.y + clicked.height / scale };
    return { id, color, kind: tool, rect: boxBetween(from, end), text: '' };
  }
  if (to === null) return null;
  if (tool === 'line' || tool === 'arrow')
    return {
      id,
      color,
      kind: 'line',
      points: [bounded(from), bounded(to)],
      arrowStart: false,
      arrowEnd: tool === 'arrow',
    };
  return { id, color, kind: tool, rect: boxBetween(from, to) };
}

/**
 * A stroke with one more point the hand passed through. At the wire's point
 * budget it keeps every other point, so a long scribble thins instead of ending.
 */
export function extendStroke(points: AnnotationPoint[], next: AnnotationPoint): AnnotationPoint[] {
  const last = points.at(-1);
  if (last?.x === next.x && last.y === next.y) return points;
  const kept = points.length < MAX_DRAWN_POINTS ? points : points.filter((_, at) => at % 2 === 0);
  return [...kept, bounded(next)];
}

export function movedDraft(draft: AnnotationDraft, delta: AnnotationPoint): AnnotationDraft {
  const shift = (at: AnnotationPoint) => bounded({ x: at.x + delta.x, y: at.y + delta.y });
  if (isBoxDraft(draft)) return { ...draft, rect: { ...draft.rect, ...shift(draft.rect) } };
  return { ...draft, points: draft.points.map(shift) };
}

/**
 * A mark with one handle dragged by `delta`: a box keeps the opposite corner
 * where it was, and a line keeps its other end. Moving by the drag rather than
 * to the pointer keeps a handle grabbed off its centre from jumping.
 */
export function resizedDraft(
  draft: AnnotationDraft,
  handle: AnnotationHandle,
  delta: AnnotationPoint,
): AnnotationDraft {
  const shift = (at: AnnotationPoint) => bounded({ x: at.x + delta.x, y: at.y + delta.y });
  if (draft.kind === 'line') {
    const [start, end] = draft.points;
    if (handle === 'start') return { ...draft, points: [shift(start), end] };
    if (handle === 'end') return { ...draft, points: [start, shift(end)] };
    return draft;
  }
  if (!isBoxDraft(draft) || handle === 'start' || handle === 'end') return draft;
  const { x, y, width, height } = draft.rect;
  const west = handle === 'nw' || handle === 'sw';
  const north = handle === 'nw' || handle === 'ne';
  const fixed = { x: west ? x + width : x, y: north ? y + height : y };
  const dragged = { x: west ? x : x + width, y: north ? y : y + height };
  return { ...draft, rect: boxBetween(fixed, shift(dragged)) };
}

/** The box a mark occupies, which its selection outlines and its author glyph sits on. */
export function draftBounds(draft: AnnotationDraft): AnnotationRect {
  if (isBoxDraft(draft)) return draft.rect;
  const xs = draft.points.map((at) => at.x);
  const ys = draft.points.map((at) => at.y);
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  return { x, y, width: Math.max(...xs) - x, height: Math.max(...ys) - y };
}

/**
 * The type size of a text or note in board pixels. The wire has no font size,
 * so the box decides: a label fills its height line by line, and a note takes a
 * size its box holds several lines of.
 */
export function textSizePx(draft: TextDraft): number {
  const { width, height } = draft.rect;
  if (draft.kind === 'note') return Math.max(4, Math.min(width / 14, height / 9));
  const lines = Math.max(1, draft.text.split('\n').length);
  return Math.max(4, height / lines / 1.3);
}

function xy(at: AnnotationPoint): string {
  return `${String(at.x)} ${String(at.y)}`;
}

/** A freehand stroke, smoothed through the midpoints between the points it kept. */
export function strokePath(points: readonly AnnotationPoint[]): string {
  let path = `M${xy(points[0])}`;
  for (let at = 1; at < points.length - 1; at += 1) {
    const next = points[at + 1];
    path += ` Q${xy(points[at])} ${xy({ x: (points[at].x + next.x) / 2, y: (points[at].y + next.y) / 2 })}`;
  }
  return `${path} L${xy(points[points.length - 1])}`;
}

/** A line and its arrowheads, each head `headLength` board pixels long. */
export function linePath(
  [start, end]: readonly AnnotationPoint[],
  arrowStart: boolean,
  arrowEnd: boolean,
  headLength: number,
): string {
  let path = `M${xy(start)} L${xy(end)}`;
  if (arrowEnd) path += arrowHead(start, end, headLength);
  if (arrowStart) path += arrowHead(end, start, headLength);
  return path;
}

/** The two strokes of a head at `tip`, opening back toward `tail`. */
function arrowHead(tail: AnnotationPoint, tip: AnnotationPoint, length: number): string {
  const back = Math.atan2(tail.y - tip.y, tail.x - tip.x);
  const wing = (turn: number) => ({
    x: tip.x + Math.cos(back + turn) * length,
    y: tip.y + Math.sin(back + turn) * length,
  });
  const spread = Math.PI / 7;
  return ` M${xy(wing(spread))} L${xy(tip)} L${xy(wing(-spread))}`;
}
