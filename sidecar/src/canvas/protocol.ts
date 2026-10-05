// Canvas wire DTOs. Mutation inputs are defined once by the Zod parsers in
// schema.ts and re-exported here; the renderer keeps a hand-written mirror at
// src/features/canvas/protocol.ts, and schema.test.ts stops compiling when the
// two drift.

import type { DesignRef, DesignSystemRef, FrameRect } from './schema.js';

export type {
  ArrangeFramesInput,
  CanvasSeed,
  CreateFramesInput,
  DesignRef,
  DesignSystemRef,
  FrameRect,
  RevisionRef,
  SourceFiles,
  WriteFilesInput,
} from './schema.js';

// A selected element inside one rendered revision. `instancePath` distinguishes
// repeated DOM nodes; it is a selection hint, not a second source model.
export interface ElementRef {
  designId: string;
  revisionId: string;
  elementId: string;
  instancePath: string;
}

// The references a turn pinned when its lease was minted. Later selection
// changes cannot retarget an earlier request, so this never changes.
export interface CanvasTurnContext {
  designs: DesignRef[];
  elements: ElementRef[];
  designSystem: DesignSystemRef;
}

export interface CanvasScope {
  scopeId: string;
  appSessionId: string;
  generation: number;
  // null for an unattached chat's lease (spec §6); the first canvas_create
  // under that lease fills the binding exactly once.
  canvasId: string | null;
  context: CanvasTurnContext;
  allowedDesignIds: string[] | 'canvas';
}

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
