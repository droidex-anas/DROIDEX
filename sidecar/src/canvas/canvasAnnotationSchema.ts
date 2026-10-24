// Board annotations: the sketches, shapes, labels and notes drawn over a canvas
// by the user or an agent. They never touch a frame or its source, so the
// manifest versions them on their own (`annotationsVersion`), and a mark drawn
// while a frame moves never conflicts with that move.

import { z } from 'zod';
import { canvasIdentifierSchema } from './schema.js';

export const ANNOTATION_LIMITS = {
  maxAnnotationsPerCanvas: 256,
  maxUpsertsPerChange: 64,
  maxDeletesPerChange: 256,
  /** A stroke may arrive this dense; it is simplified before it is saved. */
  maxDrawnPathPoints: 2048,
  maxSavedPathPoints: 128,
  maxTextLength: 2000,
  maxDimensionPx: 65_536,
  /** No board is this wide; the bound is what keeps a saved coordinate JSON-safe. */
  maxCoordinatePx: 10_000_000,
} as const;

/** Token names the board resolves against its theme; a raw colour never crosses the wire. */
const ANNOTATION_COLORS = ['ink', 'red', 'orange', 'yellow', 'green', 'blue', 'violet'] as const;

const COORDINATE_MESSAGE = `Annotation coordinates must be finite numbers within ${String(ANNOTATION_LIMITS.maxCoordinatePx)} board pixels of the origin.`;
const DIMENSION_MESSAGE = `Annotation width and height must be above 0 and at most ${String(ANNOTATION_LIMITS.maxDimensionPx)} pixels.`;
const TEXT_MESSAGE = `Annotation text is 1 to ${String(ANNOTATION_LIMITS.maxTextLength)} characters without control characters other than line breaks.`;
const PATH_MESSAGE = `A freehand path has 2 to ${String(ANNOTATION_LIMITS.maxDrawnPathPoints)} points.`;
const UPSERT_COUNT_MESSAGE = `One annotate adds or changes at most ${String(ANNOTATION_LIMITS.maxUpsertsPerChange)} annotations.`;
const DELETE_COUNT_MESSAGE = `One annotate removes at most ${String(ANNOTATION_LIMITS.maxDeletesPerChange)} annotations.`;
const EMPTY_CHANGE_MESSAGE = 'An annotate adds, changes or removes at least one annotation.';
const REPEAT_MESSAGE = 'An annotation can appear only once in an annotate.';

const coordinateSchema = z
  .number({ invalid_type_error: COORDINATE_MESSAGE })
  .finite(COORDINATE_MESSAGE)
  .min(-ANNOTATION_LIMITS.maxCoordinatePx, COORDINATE_MESSAGE)
  .max(ANNOTATION_LIMITS.maxCoordinatePx, COORDINATE_MESSAGE);
const dimensionSchema = z
  .number({ invalid_type_error: DIMENSION_MESSAGE })
  .finite(DIMENSION_MESSAGE)
  .positive(DIMENSION_MESSAGE)
  .max(ANNOTATION_LIMITS.maxDimensionPx, DIMENSION_MESSAGE);
const pointSchema = z.object({ x: coordinateSchema, y: coordinateSchema }).strict();
const rectSchema = z
  .object({
    x: coordinateSchema,
    y: coordinateSchema,
    width: dimensionSchema,
    height: dimensionSchema,
  })
  .strict();
// A note keeps its line breaks and tabs; every other control character is refused.
const textSchema = z
  .string()
  .min(1, TEXT_MESSAGE)
  .max(ANNOTATION_LIMITS.maxTextLength, TEXT_MESSAGE)
  .refine(isPlainText, TEXT_MESSAGE);

const authorSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('user') }).strict(),
  // The chat whose agent drew it; only that chat's agent may change it again.
  z.object({ kind: z.literal('agent'), chatId: z.string().min(1).max(200) }).strict(),
]);

/** The drawn kinds, with what the sidecar stamps on a saved one given by `stamp`. */
function annotationSchemaWith<Stamp extends z.ZodRawShape>(stamp: Stamp) {
  const common = { id: canvasIdentifierSchema, color: z.enum(ANNOTATION_COLORS), ...stamp };
  return z.discriminatedUnion('kind', [
    z.object({ ...common, kind: z.enum(['rect', 'ellipse']), rect: rectSchema }).strict(),
    // A text label or a sticky note, both laid out inside their rect.
    z
      .object({ ...common, kind: z.enum(['text', 'note']), rect: rectSchema, text: textSchema })
      .strict(),
    // `arrowStart` caps points[0] and `arrowEnd` caps points[1].
    z
      .object({
        ...common,
        kind: z.literal('line'),
        points: z.array(pointSchema).length(2),
        arrowStart: z.boolean(),
        arrowEnd: z.boolean(),
      })
      .strict(),
    z
      .object({
        ...common,
        kind: z.literal('path'),
        points: z
          .array(pointSchema)
          .min(2, PATH_MESSAGE)
          .max(ANNOTATION_LIMITS.maxDrawnPathPoints, PATH_MESSAGE),
      })
      .strict(),
  ]);
}

/** What a client draws; the sidecar owns who made it and when. */
const annotationDraftSchema = annotationSchemaWith({});

export const annotationSchema = annotationSchemaWith({
  author: authorSchema,
  createdAt: z.number().int().nonnegative(),
  updatedAt: z.number().int().nonnegative(),
});

export const annotateCanvasInputSchema = z
  .object({
    mutationId: canvasIdentifierSchema,
    expectedAnnotationsVersion: z.number().int().nonnegative(),
    upserts: z
      .array(annotationDraftSchema)
      .max(ANNOTATION_LIMITS.maxUpsertsPerChange, UPSERT_COUNT_MESSAGE),
    deletes: z
      .array(canvasIdentifierSchema)
      .max(ANNOTATION_LIMITS.maxDeletesPerChange, DELETE_COUNT_MESSAGE),
  })
  .strict()
  .superRefine((input, ctx) => {
    const ids = [...input.upserts.map((draft) => draft.id), ...input.deletes];
    if (ids.length === 0)
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: EMPTY_CHANGE_MESSAGE });
    if (new Set(ids).size !== ids.length)
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: REPEAT_MESSAGE });
  });

export type AnnotationPoint = z.infer<typeof pointSchema>;
export type AnnotationAuthor = z.infer<typeof authorSchema>;
export type AnnotationDraft = z.infer<typeof annotationDraftSchema>;
export type Annotation = z.infer<typeof annotationSchema>;
export type AnnotateCanvasInput = z.infer<typeof annotateCanvasInputSchema>;

/** One commit's effect on the annotation layer, carried by the change it belongs to. */
export interface AnnotationChange {
  /** The layer's version after this change, the next annotate's expected version. */
  version: number;
  /** Added or redrawn annotations; a new one is drawn above every earlier one. */
  upserted: Annotation[];
  removedIds: string[];
}

/** The annotation a draft saves as, keeping its first author and creation time. */
export function savedAnnotation(
  draft: AnnotationDraft,
  author: AnnotationAuthor,
  now: number,
  previous: Annotation | undefined,
): Annotation {
  const stamp = {
    author: previous?.author ?? author,
    createdAt: previous?.createdAt ?? now,
    updatedAt: now,
  };
  if (draft.kind !== 'path') return { ...draft, ...stamp };
  const points = simplifiedStroke(draft.points, ANNOTATION_LIMITS.maxSavedPathPoints).map(
    ({ x, y }) => ({ x: tenth(x), y: tenth(y) }),
  );
  return { ...draft, points, ...stamp };
}

/** A kept point this close to the line its neighbours draw carries no shape. */
const STRAIGHT_STROKE_PX = 0.5;

/**
 * Thins a stroke to `maxPoints` without letting one end of it dominate the
 * sample: the drawn path is cut into as many equal parts as there are points to
 * keep, and each part gives up the one point it cannot lose, the point farthest
 * from the chord across that part. A corner survives wherever it is drawn, while
 * a straight run costs nothing, and ranking every point of the whole stroke
 * instead would keep a uniform zigzag only where it happens to deviate most.
 */
export function simplifiedStroke(
  points: readonly AnnotationPoint[],
  maxPoints: number,
): AnnotationPoint[] {
  if (points.length <= maxPoints) return [...points];
  const interiorPoints = points.length - 2;
  const parts = maxPoints - 2;
  const sampled: number[] = [0];
  for (let part = 0; part < parts; part += 1) {
    const first = 1 + Math.floor((part * interiorPoints) / parts);
    const last = 1 + Math.floor(((part + 1) * interiorPoints) / parts);
    sampled.push(mostSignificantPoint(points, first, last));
  }
  sampled.push(points.length - 1);
  return keepBends(points, sampled);
}

/** The point of `first` .. `last - 1` farthest from the chord before it to `last`. */
function mostSignificantPoint(
  points: readonly AnnotationPoint[],
  first: number,
  last: number,
): number {
  const start = points[first - 1];
  const end = points[last];
  let significant = first;
  let farthest = -1;
  for (let index = first; index < last; index += 1) {
    const distance = segmentDistance(points[index], start, end);
    if (distance <= farthest) continue;
    significant = index;
    farthest = distance;
  }
  return significant;
}

/** Drops the sampled points that only repeat the line between their neighbours. */
function keepBends(
  points: readonly AnnotationPoint[],
  sampled: readonly number[],
): AnnotationPoint[] {
  const kept = [sampled[0]];
  for (let position = 1; position < sampled.length - 1; position += 1) {
    const previous = points[kept[kept.length - 1]];
    const next = points[sampled[position + 1]];
    const distance = segmentDistance(points[sampled[position]], previous, next);
    if (distance <= STRAIGHT_STROKE_PX) continue;
    kept.push(sampled[position]);
  }
  kept.push(sampled[sampled.length - 1]);
  return kept.map((index) => points[index]);
}

/** How far `point` lies from the segment between `start` and `end`. */
function segmentDistance(
  point: AnnotationPoint,
  start: AnnotationPoint,
  end: AnnotationPoint,
): number {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const lengthSquared = dx * dx + dy * dy;
  const along =
    lengthSquared === 0
      ? 0
      : Math.max(
          0,
          Math.min(1, ((point.x - start.x) * dx + (point.y - start.y) * dy) / lengthSquared),
        );
  return Math.hypot(point.x - (start.x + along * dx), point.y - (start.y + along * dy));
}

function tenth(value: number): number {
  return Math.round(value * 10) / 10;
}

/** A tab or a line break is the only control character annotation text keeps. */
function isPlainText(value: string): boolean {
  for (const character of value) {
    const code = character.codePointAt(0) ?? 0;
    if (code === 0x09 || code === 0x0a) continue;
    if (code < 0x20 || (code >= 0x7f && code <= 0x9f)) return false;
  }
  return true;
}
