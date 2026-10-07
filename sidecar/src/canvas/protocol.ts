// Canvas wire DTOs. Mutation inputs are defined once by the Zod parsers in
// schema.ts and re-exported here; the renderer keeps a hand-written mirror at
// src/features/canvas/protocol.ts, and schema.test.ts stops compiling when the
// two drift.

import type {
  ArrangeFramesInput,
  CanvasTurnContext,
  CreateFramesInput,
  DesignSystemRef,
  FrameRect,
  RemoveFramesInput,
  RenameFrameInput,
  UndoRemovalInput,
  WriteFilesInput,
} from './schema.js';

export type {
  ArrangeFramesInput,
  CanvasTurnContext,
  CreateFramesInput,
  DesignRef,
  DesignSystemRef,
  ElementRef,
  FrameRect,
  RemoveFramesInput,
  RenameFrameInput,
  RevisionRef,
  SourceFiles,
  UndoRemovalInput,
  WriteFilesInput,
} from './schema.js';

/**
 * What one mutation is authorized to change. A turn lease pins the references
 * its request was composed with and expires with the turn (spec §6). A pane
 * mutation is authorized by the chat's attachment instead: it has no turn
 * generation and pins nothing, because the request names its own targets.
 */
export type CanvasScope =
  | {
      origin: 'turn';
      scopeId: string;
      appSessionId: string;
      generation: number;
      // null for an unattached chat's lease (spec §6); the first canvas_create
      // under that lease fills the binding exactly once.
      canvasId: string | null;
      context: CanvasTurnContext;
      allowedDesignIds: string[] | 'canvas';
    }
  | {
      origin: 'user';
      scopeId: string;
      appSessionId: string;
      canvasId: string;
      allowedDesignIds: 'canvas';
    };

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

/**
 * One built revision's preview document and the ID of that document. A preview
 * loads this in its guest; nothing else reads it.
 */
export interface PreviewArtifact {
  artifactId: string;
  html: string;
}

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
// The pane's half of the Canvas contract. `appSessionId` is the only session
// identity on the wire; a mutation names the canvas its chat is attached to, and
// `canvasBridge.ts` refuses one that disagrees. Every request carries a
// requestId, and `canvasCommandSchema` in canvasBridge.ts validates this union.

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
