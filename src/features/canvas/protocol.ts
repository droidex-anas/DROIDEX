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

/**
 * One built revision's preview document and the ID of that document. A preview
 * loads this in its guest; nothing else reads it.
 */
export interface PreviewArtifact {
  artifactId: string;
  html: string;
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

/** What one design's build is doing, on its own. */
export type CanvasBuildOutcome =
  | { status: 'pending' }
  | { status: 'building'; revisionId: string }
  | { status: 'ready'; revisionId: string; artifactId: string }
  | {
      status: 'failed';
      revisionId: string;
      diagnostics: CanvasDiagnostic[];
      lastWorkingRevisionId: string | null;
    }
  | { status: 'cancelled'; revisionId: string | null };

/**
 * One design's build state and the attempt it belongs to. `generation` is the
 * per-design attempt counter, which only ever increases, so a reader can tell a
 * build that actually moved from a frame that was merely re-sent: an arrange
 * re-sends every frame it touches with its build untouched.
 */
export type CanvasBuildState = CanvasBuildOutcome & { generation: number };

export interface CanvasFrame {
  designId: string;
  name: string;
  rect: FrameRect;
  layoutVersion: number;
  manifestVersion: number;
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

export interface RemoveFramesInput {
  mutationId: string;
  designIds: string[];
}

export interface UndoRemovalInput {
  mutationId: string;
  undoId: string;
}

export interface RenameFrameInput {
  mutationId: string;
  designId: string;
  name: string;
  expectedManifestVersion: number;
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
  | 'storage_failed'
  | 'layout_conflict'
  | 'not_found';

export interface CanvasError {
  code: CanvasErrorCode;
  message: string;
  currentRect?: FrameRect;
}

// ── Bridge commands and events ───────────────────────────────────────
// `appSessionId` is the only session identity on the wire. A mutation names the
// canvas its chat is attached to, and the sidecar refuses one that disagrees.

export type CanvasCommand =
  | { type: 'canvas.list'; requestId: string }
  | { type: 'canvas.attachment'; requestId: string; appSessionId: string }
  | { type: 'canvas.subscribe'; requestId: string; canvasId: string }
  | { type: 'canvas.unsubscribe'; requestId: string; canvasId: string }
  // A derived read, authorized like `canvas.subscribe` by the page asking: the
  // artifact is a projection of a canvas any renderer page may watch.
  | {
      type: 'canvas.readArtifact';
      requestId: string;
      canvasId: string;
      designId: string;
      revisionId: string;
    }
  | { type: 'canvas.createCanvas'; requestId: string; appSessionId: string }
  | { type: 'canvas.attach'; requestId: string; appSessionId: string; canvasId: string }
  | { type: 'canvas.detach'; requestId: string; appSessionId: string }
  | {
      type: 'canvas.create';
      requestId: string;
      appSessionId: string;
      canvasId: string;
      input: CreateFramesInput;
    }
  | {
      type: 'canvas.write';
      requestId: string;
      appSessionId: string;
      canvasId: string;
      input: WriteFilesInput;
    }
  | {
      type: 'canvas.arrange';
      requestId: string;
      appSessionId: string;
      canvasId: string;
      input: ArrangeFramesInput;
    }
  | {
      type: 'canvas.remove';
      requestId: string;
      appSessionId: string;
      canvasId: string;
      input: RemoveFramesInput;
    }
  | {
      type: 'canvas.undoRemoval';
      requestId: string;
      appSessionId: string;
      canvasId: string;
      input: UndoRemovalInput;
    }
  | {
      type: 'canvas.renameFrame';
      requestId: string;
      appSessionId: string;
      canvasId: string;
      input: RenameFrameInput;
    };

/** What a successful command answers with, one kind per command. */
export type CanvasReply =
  | { kind: 'ok' }
  | { kind: 'summaries'; summaries: CanvasSummary[] }
  | { kind: 'attachment'; canvasId: string | null }
  | { kind: 'created'; created: CreateFramesResult }
  | { kind: 'written'; receipt: WriteReceipt }
  | { kind: 'arranged'; change: CanvasChange }
  | { kind: 'removed'; undoId: string }
  | { kind: 'undone'; change: CanvasChange }
  | { kind: 'renamed'; change: CanvasChange }
  | { kind: 'artifact'; artifact: PreviewArtifact | null };

export type CanvasEvent =
  | { type: 'canvas.result'; requestId: string; ok: true; reply: CanvasReply }
  | { type: 'canvas.result'; requestId: string; ok: false; error: CanvasError }
  // The reply to a subscribe, and the projection every later change extends.
  | { type: 'canvas.snapshot'; requestId: string; snapshot: CanvasSnapshot }
  | { type: 'canvas.summaries'; summaries: CanvasSummary[] }
  // Broadcast with its canvasId, because the bridge server has no per-connection
  // targeting; a client that does not watch that canvas drops it.
  | { type: 'canvas.change'; change: CanvasChange };
