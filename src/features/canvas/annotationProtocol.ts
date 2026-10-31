// Board annotation DTOs, mirrored by hand from
// sidecar/src/canvas/canvasAnnotationSchema.ts like the rest of protocol.ts;
// sidecar/src/canvas/schema.test.ts stops compiling when the two drift.

/** Token names the board resolves against its theme; a raw colour never crosses the wire. */
export type AnnotationColor = 'ink' | 'red' | 'orange' | 'yellow' | 'green' | 'blue' | 'violet';

/** Board coordinates; an annotation may be far larger than any frame. */
export interface AnnotationRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface AnnotationPoint {
  x: number;
  y: number;
}

/** The chat whose agent drew it; only that chat's agent may change it again. */
export type AnnotationAuthor = { kind: 'user' } | { kind: 'agent'; chatId: string };

/** What the board draws, in board coordinates. The sidecar stamps who made it and when. */
export type AnnotationDraft =
  | { id: string; color: AnnotationColor; kind: 'rect' | 'ellipse'; rect: AnnotationRect }
  | {
      id: string;
      color: AnnotationColor;
      kind: 'text' | 'note';
      rect: AnnotationRect;
      text: string;
    }
  | {
      id: string;
      color: AnnotationColor;
      kind: 'line';
      /** Two points: `arrowStart` caps the first and `arrowEnd` the second. */
      points: AnnotationPoint[];
      arrowStart: boolean;
      arrowEnd: boolean;
    }
  // Saved simplified, so the stroke that comes back may have fewer points.
  | { id: string; color: AnnotationColor; kind: 'path'; points: AnnotationPoint[] };

interface AnnotationStamp {
  author: AnnotationAuthor;
  createdAt: number;
  updatedAt: number;
}

export type Annotation = AnnotationDraft extends infer Draft
  ? Draft extends AnnotationDraft
    ? { [Key in keyof (Draft & AnnotationStamp)]: (Draft & AnnotationStamp)[Key] }
    : never
  : never;

export interface AnnotateCanvasInput {
  mutationId: string;
  /** The snapshot's `annotationsVersion`; a stale one is a `revision_conflict`. */
  expectedAnnotationsVersion: number;
  upserts: AnnotationDraft[];
  deletes: string[];
}

/** One commit's effect on the annotation layer, carried by the change it belongs to. */
export interface AnnotationChange {
  /** The layer's version after this change, the next annotate's expected version. */
  version: number;
  /** Added or redrawn annotations; a new one is drawn above every earlier one. */
  upserted: Annotation[];
  removedIds: string[];
}
