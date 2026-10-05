// Canvas wire DTOs, mirrored by hand from sidecar/src/canvas/protocol.ts — keep
// them in sync. The renderer cannot import sidecar source and has no Zod, so
// this file carries no validation: the sidecar owns the boundary, and
// sidecar/src/canvas/schema.test.ts stops compiling when the two drift.
//
// CanvasScope is the sidecar's turn lease and is deliberately absent here; the
// renderer only ever sends the pinned CanvasTurnContext beside its prompt.

export interface DesignSystemRef {
  id: string;
  version: number;
  mode: 'light' | 'dark';
}

export interface DesignRef {
  designId: string;
  revisionId: string | null;
}

export interface RevisionRef {
  designId: string;
  revisionId: string;
}

export type CanvasSeed =
  | { kind: 'revision'; canvasId: string; revision: RevisionRef }
  | { kind: 'library'; itemId: string };

// A selected element inside one rendered revision. `instancePath` distinguishes
// repeated DOM nodes; it is a selection hint, not a second source model.
export interface ElementRef {
  designId: string;
  revisionId: string;
  elementId: string;
  instancePath: string;
}

// The references a request pins when it is composed. They travel with the
// prompt through queue, steer and send-now, so a later selection change cannot
// retarget an earlier request.
export interface CanvasTurnContext {
  designs: DesignRef[];
  elements: ElementRef[];
  designSystem: DesignSystemRef;
}

export interface FrameRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export type SourceFiles = Record<string, string>;

export interface CanvasDiagnostic {
  code: string;
  message: string;
  file?: string;
  line?: number;
  column?: number;
}

export interface SourceElement {
  elementId: string;
  file: string;
  start: number;
  end: number;
  tagName: string;
  editability: 'literal' | 'computed' | 'shared';
}

export type CanvasBuildState =
  | { status: 'pending' }
  | { status: 'building'; revisionId: string; generation: number }
  | { status: 'ready'; revisionId: string; artifactId: string }
  | {
      status: 'failed';
      revisionId: string;
      diagnostics: CanvasDiagnostic[];
      lastWorkingRevisionId: string | null;
    }
  | { status: 'cancelled'; revisionId: string | null };

export interface CanvasFrame {
  designId: string;
  name: string;
  rect: FrameRect;
  layoutVersion: number;
  // null while the frame is reserved and has no source yet.
  revisionId: string | null;
  designSystem: DesignSystemRef;
  build: CanvasBuildState;
}

// `sequence` orders renderer projections; it is not the source CAS token.
export interface CanvasSnapshot {
  canvasId: string;
  sequence: number;
  frames: CanvasFrame[];
}

export interface CanvasChange {
  canvasId: string;
  sequence: number;
  frames: CanvasFrame[];
  removedDesignIds: string[];
}

export interface CanvasSummary {
  canvasId: string;
  name: string;
  updatedAt: number;
  designCount: number;
}

// `create` answers with the canvas as well as the frames because an unattached
// chat's first create mints the canvas it is now attached to (spec §6).
export interface CreateFramesResult {
  canvasId: string;
  frames: CanvasFrame[];
}

export interface WriteReceipt {
  designId: string;
  revisionId: string;
  sequence: number;
}

export interface CreateFramesInput {
  mutationId: string;
  frames: {
    name: string;
    width: number;
    height: number;
    designSystem: DesignSystemRef;
    seed?: CanvasSeed;
  }[];
}

export interface WriteFilesInput {
  mutationId: string;
  designId: string;
  expectedRevisionId: string | null;
  files: SourceFiles;
  deletedPaths: string[];
  designSystem?: DesignSystemRef;
}

export interface ArrangeFramesInput {
  mutationId: string;
  frames: { designId: string; expectedLayoutVersion: number; rect: FrameRect }[];
}

// The stable codes from spec §8. Every failure carries a short recovery message
// and never a stack trace, private path or provider prompt.
export type CanvasErrorCode =
  | 'invalid_input'
  | 'revision_conflict'
  | 'invalid_source_path'
  | 'unsupported_import'
  | 'build_timeout'
  | 'capture_unavailable'
  | 'scope_expired'
  | 'storage_failed';

export interface CanvasError {
  code: CanvasErrorCode;
  message: string;
}
