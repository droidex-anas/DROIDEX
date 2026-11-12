// A selected `<path>`'s geometry, as its preview guest reads it: the path's own
// data, the matrix that maps its user units to the design's pixels, and its box
// there. The board edits the data and draws handles through the matrix.

import { readPathData } from './paths/pathData';
import { jsonArgument, readAnswer, readRect, record, type PreviewNode } from './previewDocument';
import type { FrameRect } from './protocol';

/** Bytes a path's `d` may measure in an answer, as the reporter caps it. */
const MAX_PREVIEW_PATH_DATA_BYTES = 16 * 1024;
/** JSON escaping at most doubles the whitespace a `d` may carry. */
const MAX_PREVIEW_SHAPE_ANSWER_BYTES = 2 * MAX_PREVIEW_PATH_DATA_BYTES + 1024;
/** `unreadable`: the source's own `d` is not path data the board can edit. */
const SHAPE_REFUSALS = ['not_path', 'not_drawn', 'too_large', 'unreadable'] as const;

/** `matrix` is `[a, b, c, d, e, f]` of `getScreenCTM()`: x' = a·x + c·y + e, y' = b·x + d·y + f. */
export type PreviewShape =
  | { d: string; matrix: PreviewMatrix; rect: FrameRect }
  | { refused: (typeof SHAPE_REFUSALS)[number] };
export type PreviewMatrix = [number, number, number, number, number, number];

/** Asks for one drawn instance's path geometry; the call itself answers. */
export function previewShapeScript(node: PreviewNode): string {
  const asked = { elementId: node.elementId, instancePath: node.instancePath };
  return `globalThis.__droidexCanvasPreview.shape(${jsonArgument(asked)})`;
}

/** A shape answer, or null when the answer is not one or names nothing. */
export function readPreviewShape(value: unknown): PreviewShape | null {
  const parsed = readAnswer(value, MAX_PREVIEW_SHAPE_ANSWER_BYTES);
  if (!record(parsed)) return null;
  const refusal = SHAPE_REFUSALS.find((refused) => refused === parsed.refused);
  if (refusal) return { refused: refusal };
  const { d, matrix } = parsed;
  const rect = readRect(parsed.rect);
  if (!rect || !isMatrix(matrix)) return null;
  if (typeof d !== 'string' || d.length > MAX_PREVIEW_PATH_DATA_BYTES || !readPathData(d, 'source'))
    return null;
  return { d, matrix: [...matrix], rect };
}

function isMatrix(value: unknown): value is PreviewMatrix {
  return (
    Array.isArray(value) &&
    value.length === 6 &&
    value.every((entry) => typeof entry === 'number' && Number.isFinite(entry))
  );
}
