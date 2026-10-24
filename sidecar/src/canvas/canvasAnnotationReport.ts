// What the agent is told about the annotations on its board: each mark's shape
// in whole board pixels and how it relates to the frames the read shows. The
// relations are computed here, so "make the header look like this sketch" reaches
// the model as a sketch over a named frame, not as geometry it has to solve.

import {
  simplifiedStroke,
  type Annotation,
  type AnnotationPoint,
} from './canvasAnnotationSchema.js';
import type { CanvasFrame, FrameRect } from './protocol.js';

/** A frame within this gap of a mark that touches none is the frame it is about. */
const NEAR_PX = 240;
/** An arrow head this close to a frame points at it; farther, it points at empty board. */
const HEAD_REACH_PX = 48;
/** A stroke as the model reads it: the most significant points, in whole pixels. */
const READ_STROKE_POINTS = 32;
/** A stroke whose ends meet within this share of its size is a closed loop around something. */
const LOOP_CLOSURE = 0.2;

export interface AgentAnnotation {
  id: string;
  kind: Annotation['kind'];
  /** `you` marks what this chat drew, the only annotations it may change. */
  author: 'user' | 'you' | 'another chat';
  color: Annotation['color'];
  rect?: FrameRect;
  points?: [number, number][];
  arrowStart?: true;
  arrowEnd?: true;
  text?: string;
  /** Frames the mark touches, or a closed loop encloses. */
  over?: string[];
  /** The closest frame, when the mark touches none and one is within reach. */
  near?: string;
  /** The frame an arrow's head reaches. */
  pointsAt?: string;
}

type BoardFrame = Pick<CanvasFrame, 'designId' | 'rect'>;

export function agentAnnotation(
  annotation: Annotation,
  frames: readonly BoardFrame[],
  chatId: string,
): AgentAnnotation {
  const over = framesUnder(annotation, frames);
  const near = over.length === 0 ? nearestFrame(bounds(annotation), frames, NEAR_PX) : undefined;
  const head = arrowHead(annotation);
  const pointsAt = head && nearestFrame(pointRect(head), frames, HEAD_REACH_PX);
  return {
    id: annotation.id,
    kind: annotation.kind,
    author: authorFor(annotation, chatId),
    color: annotation.color,
    ...agentShape(annotation),
    ...(over.length > 0 ? { over } : {}),
    ...(near ? { near } : {}),
    ...(pointsAt ? { pointsAt } : {}),
  };
}

function authorFor(annotation: Annotation, chatId: string): AgentAnnotation['author'] {
  if (annotation.author.kind === 'user') return 'user';
  return annotation.author.chatId === chatId ? 'you' : 'another chat';
}

function agentShape(
  annotation: Annotation,
): Pick<AgentAnnotation, 'rect' | 'points' | 'arrowStart' | 'arrowEnd' | 'text'> {
  switch (annotation.kind) {
    case 'rect':
    case 'ellipse':
      return { rect: roundedRect(annotation.rect) };
    case 'text':
    case 'note':
      return { rect: roundedRect(annotation.rect), text: annotation.text };
    case 'line':
      return {
        points: annotation.points.map(roundedPoint),
        ...(annotation.arrowStart ? { arrowStart: true as const } : {}),
        ...(annotation.arrowEnd ? { arrowEnd: true as const } : {}),
      };
    case 'path':
      return {
        points: simplifiedStroke(annotation.points, READ_STROKE_POINTS).map(roundedPoint),
      };
  }
}

function framesUnder(annotation: Annotation, frames: readonly BoardFrame[]): string[] {
  if (annotation.kind !== 'line' && annotation.kind !== 'path')
    return frames.filter((frame) => overlaps(annotation.rect, frame.rect)).map(designIdOf);
  const { points } = annotation;
  const loop = annotation.kind === 'path' && isClosedLoop(points);
  return frames
    .filter(
      (frame) =>
        points.some(
          (point, index) => index > 0 && segmentTouches(points[index - 1], point, frame.rect),
        ) ||
        (loop && encloses(points, centerOf(frame.rect))),
    )
    .map(designIdOf);
}

/** The point an arrow points with: its end head, else its start head. */
function arrowHead(annotation: Annotation): AnnotationPoint | undefined {
  if (annotation.kind !== 'line') return undefined;
  if (annotation.arrowEnd) return annotation.points[1];
  return annotation.arrowStart ? annotation.points[0] : undefined;
}

function nearestFrame(
  rect: FrameRect,
  frames: readonly BoardFrame[],
  reachPx: number,
): string | undefined {
  let nearest: string | undefined;
  let nearestGap = reachPx;
  for (const frame of frames) {
    const gap = gapBetween(rect, frame.rect);
    if (gap > nearestGap || (nearest !== undefined && gap === nearestGap)) continue;
    nearest = frame.designId;
    nearestGap = gap;
  }
  return nearest;
}

function bounds(annotation: Annotation): FrameRect {
  if (annotation.kind !== 'line' && annotation.kind !== 'path') return annotation.rect;
  return pointBounds(annotation.points);
}

function pointBounds(points: readonly AnnotationPoint[]): FrameRect {
  const xs = points.map((point) => point.x);
  const ys = points.map((point) => point.y);
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  return { x, y, width: Math.max(...xs) - x, height: Math.max(...ys) - y };
}

function isClosedLoop(points: readonly AnnotationPoint[]): boolean {
  const first = points[0];
  const last = points[points.length - 1];
  const { width, height } = pointBounds(points);
  return Math.hypot(last.x - first.x, last.y - first.y) <= LOOP_CLOSURE * Math.max(width, height);
}

/** Even-odd ray casting against the polygon the loop's points trace. */
function encloses(polygon: readonly AnnotationPoint[], point: AnnotationPoint): boolean {
  let inside = false;
  for (let index = 0, previous = polygon.length - 1; index < polygon.length; previous = index++) {
    const a = polygon[index];
    const b = polygon[previous];
    if (a.y > point.y === b.y > point.y) continue;
    if (point.x < ((b.x - a.x) * (point.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

/** Liang-Barsky: whether any part of the segment from `start` to `end` lies in `rect`. */
function segmentTouches(start: AnnotationPoint, end: AnnotationPoint, rect: FrameRect): boolean {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const edges: [number, number][] = [
    [-dx, start.x - rect.x],
    [dx, rect.x + rect.width - start.x],
    [-dy, start.y - rect.y],
    [dy, rect.y + rect.height - start.y],
  ];
  let enter = 0;
  let leave = 1;
  for (const [direction, distance] of edges) {
    if (direction === 0) {
      if (distance < 0) return false;
      continue;
    }
    const along = distance / direction;
    if (direction < 0) enter = Math.max(enter, along);
    else leave = Math.min(leave, along);
    if (enter > leave) return false;
  }
  return true;
}

function overlaps(left: FrameRect, right: FrameRect): boolean {
  return gapBetween(left, right) === 0;
}

/** The distance between two rects' nearest edges, 0 when they touch or overlap. */
function gapBetween(left: FrameRect, right: FrameRect): number {
  const dx = Math.max(0, left.x - (right.x + right.width), right.x - (left.x + left.width));
  const dy = Math.max(0, left.y - (right.y + right.height), right.y - (left.y + left.height));
  return Math.hypot(dx, dy);
}

function centerOf(rect: FrameRect): AnnotationPoint {
  return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
}

function pointRect(point: AnnotationPoint): FrameRect {
  return { x: point.x, y: point.y, width: 0, height: 0 };
}

function roundedRect(rect: FrameRect): FrameRect {
  return {
    x: Math.round(rect.x),
    y: Math.round(rect.y),
    width: Math.round(rect.width),
    height: Math.round(rect.height),
  };
}

function roundedPoint(point: AnnotationPoint): [number, number] {
  return [Math.round(point.x), Math.round(point.y)];
}

function designIdOf(frame: BoardFrame): string {
  return frame.designId;
}
