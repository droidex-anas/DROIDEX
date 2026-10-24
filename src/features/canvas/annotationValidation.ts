// The renderer's check of the annotation layer a Canvas snapshot or change
// carries. `wireValidation.ts` owns the rest of the event.

import { boundedList, boundedText, count, id, isAppSessionId, record } from './wireChecks';

// The annotation layer's bounds, matching `ANNOTATION_LIMITS` in the sidecar's
// canvasAnnotationSchema.ts.
export const MAX_ANNOTATIONS = 256;
const MAX_ANNOTATION_UPSERTS = 64;
const MAX_ANNOTATION_DELETES = 256;
const MAX_PATH_POINTS = 2048;
const MAX_ANNOTATION_TEXT_LENGTH = 2000;
const MAX_COORDINATE = 10_000_000;
const ANNOTATION_COLORS = new Set<unknown>([
  'ink',
  'red',
  'orange',
  'yellow',
  'green',
  'blue',
  'violet',
]);

export function isAnnotationChange(value: unknown): boolean {
  return (
    record(value) &&
    count(value.version) &&
    boundedList(value.upserted, MAX_ANNOTATION_UPSERTS, isAnnotation) &&
    boundedList(value.removedIds, MAX_ANNOTATION_DELETES, id)
  );
}

export function isAnnotation(value: unknown): boolean {
  if (
    !record(value) ||
    !id(value.id) ||
    !ANNOTATION_COLORS.has(value.color) ||
    !isAnnotationAuthor(value.author) ||
    !count(value.createdAt) ||
    !count(value.updatedAt)
  )
    return false;
  switch (value.kind) {
    case 'rect':
    case 'ellipse':
      return isAnnotationRect(value.rect);
    case 'text':
    case 'note':
      return isAnnotationRect(value.rect) && boundedText(value.text, MAX_ANNOTATION_TEXT_LENGTH);
    case 'line':
      return (
        Array.isArray(value.points) &&
        value.points.length === 2 &&
        value.points.every(isPoint) &&
        typeof value.arrowStart === 'boolean' &&
        typeof value.arrowEnd === 'boolean'
      );
    case 'path':
      return (
        boundedList(value.points, MAX_PATH_POINTS, isPoint) &&
        (value.points as unknown[]).length >= 2
      );
    default:
      return false;
  }
}

function isAnnotationAuthor(value: unknown): boolean {
  return (
    record(value) &&
    (value.kind === 'user' || (value.kind === 'agent' && isAppSessionId(value.chatId)))
  );
}

function isPoint(value: unknown): boolean {
  return record(value) && isCoordinate(value.x) && isCoordinate(value.y);
}

function isAnnotationRect(value: unknown): boolean {
  return (
    record(value) &&
    isCoordinate(value.x) &&
    isCoordinate(value.y) &&
    isCoordinate(value.width) &&
    isCoordinate(value.height)
  );
}

function isCoordinate(value: unknown): boolean {
  return typeof value === 'number' && Number.isFinite(value) && Math.abs(value) <= MAX_COORDINATE;
}
