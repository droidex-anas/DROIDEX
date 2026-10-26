// The board's optimistic annotation writes. Each finished gesture is one
// annotate, shown at once and dropped as soon as the layer's version moves past
// the version it was written against: by then the change feed carries either it
// or the change that refused it.

import type {
  Annotation,
  AnnotationAuthor,
  AnnotationDraft,
  AnnotateCanvasInput,
} from './annotationProtocol';
import { draftOf } from './annotationGeometry';

/** One mark as the board draws it, with who drew it. */
export interface ShownMark {
  draft: AnnotationDraft;
  author: AnnotationAuthor;
}

const BY_USER: AnnotationAuthor = { kind: 'user' };

/** The writes the layer at `version` has not answered yet. */
export function unansweredWrites(
  pending: readonly AnnotateCanvasInput[],
  version: number,
): AnnotateCanvasInput[] {
  return pending.filter((write) => write.expectedAnnotationsVersion >= version);
}

/**
 * The version the next write expects: the one after the last unanswered write,
 * so writes made faster than the feed answers them chain instead of conflicting.
 */
export function nextExpectedVersion(
  version: number,
  pending: readonly AnnotateCanvasInput[],
): number {
  return pending.reduce(
    (expected, write) => Math.max(expected, write.expectedAnnotationsVersion + 1),
    version,
  );
}

/** A refused write and every write chained on it, which cannot land either. */
export function withoutRefused(
  pending: readonly AnnotateCanvasInput[],
  mutationId: string,
): AnnotateCanvasInput[] {
  const at = pending.findIndex((write) => write.mutationId === mutationId);
  return at < 0 ? [...pending] : pending.slice(0, at);
}

/**
 * The layer with the unanswered writes applied in order: a redrawn mark keeps
 * its place and its author, and a new one goes on top, as the sidecar stacks them.
 */
export function shownMarks(
  annotations: readonly Annotation[],
  pending: readonly AnnotateCanvasInput[],
): ShownMark[] {
  let marks: ShownMark[] = annotations.map((annotation) => ({
    draft: draftOf(annotation),
    author: annotation.author,
  }));
  for (const { upserts, deletes } of pending) {
    const removed = new Set(deletes);
    const redrawn = new Map(upserts.map((draft) => [draft.id, draft]));
    const kept = marks
      .filter((mark) => !removed.has(mark.draft.id))
      .map((mark) => ({ ...mark, draft: redrawn.get(mark.draft.id) ?? mark.draft }));
    const held = new Set(kept.map((mark) => mark.draft.id));
    marks = [
      ...kept,
      ...upserts
        .filter((draft) => !held.has(draft.id))
        .map((draft) => ({ draft, author: BY_USER })),
    ];
  }
  return marks;
}
