// Canvas wire DTOs. Mutation inputs are defined once by the Zod parsers in
// schema.ts and re-exported here; the renderer keeps a hand-written mirror at
// src/features/canvas/protocol.ts, and schema.test.ts stops compiling when the
// two drift.

import type {
  ArrangeFramesInput,
  CanvasTurnContext,
  CreateCanvasResult,
  CreateFramesInput,
  DesignSystemAdherence,
  DesignSystemRef,
  DesignSystemVersionRef,
  EditElementInput,
  FrameRect,
  RemoveFramesInput,
  RenameFrameInput,
  RestoreRevisionInput,
  RevisionPage,
  RevisionRef,
  SourceFiles,
  StyleResolution,
  UndoRemovalInput,
  WriteFilesInput,
} from './schema.js';
import type {
  AnnotateCanvasInput,
  Annotation,
  AnnotationChange,
} from './canvasAnnotationSchema.js';
import type {
  DesignSystemDetail,
  DesignSystemSource,
  DesignSystemSummary,
} from './designSystems.js';

export type {
  ArrangeFramesInput,
  CanvasTurnContext,
  CreateCanvasResult,
  CreateFramesInput,
  DesignRef,
  DesignSystemAdherence,
  DesignSystemRef,
  DesignSystemVersionRef,
  EditElementInput,
  ElementRef,
  FrameRect,
  RemoveFramesInput,
  RenameFrameInput,
  RestoreRevisionInput,
  RevisionPage,
  RevisionRef,
  SourceFiles,
  StyleResolution,
  UndoRemovalInput,
  WriteFilesInput,
} from './schema.js';

export type ElementEdit = EditElementInput['edit'];

/** A direct edit's revision and what its style value resolved to; null for a text edit. */
export interface ElementEditResult {
  receipt: WriteReceipt;
  resolution: StyleResolution | null;
}

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
  | {
      status: 'ready';
      revisionId: string;
      artifactId: string;
      elements: SourceElement[];
      diagnostics: CanvasDiagnostic[];
    }
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

/**
 * What one mounted preview of a revision did, as the pane running it saw it:
 * `loading` while its guest starts, `failed` when the design stopped before it
 * rendered, `rendered` once it painted, with any errors it has thrown since.
 * The compiler cannot see a design that throws while rendering; this can.
 */
export interface PreviewReport {
  designId: string;
  revisionId: string;
  outcome: 'loading' | 'rendered' | 'failed';
  errors: string[];
}

/** An image copied into one canvas; no private path crosses this contract. */
export interface OwnedAsset {
  assetId: string;
  mediaType: 'image/png' | 'image/jpeg' | 'image/webp';
  byteLength: number;
  width: number;
  height: number;
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
  /** The CAS token `canvas.annotate` expects, separate from frame layout. */
  annotationsVersion: number;
  annotations: Annotation[];
}

export interface CanvasChange {
  canvasId: string;
  sequence: number;
  frames: CanvasFrame[];
  removedDesignIds: string[];
  /** Present only on a change that touched the annotation layer. */
  annotations?: AnnotationChange;
}

/** What an annotate answers: a change that always carries its annotation delta. */
export type AnnotatedChange = CanvasChange & { annotations: AnnotationChange };

export interface CanvasSummary {
  canvasId: string;
  name: string;
  updatedAt: number;
  designCount: number;
  /** The chats working on this canvas, used by Design cards and the chat menu. */
  attachedAppSessionIds: string[];
  designSystemAdherence: DesignSystemAdherence;
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

export type RevisionAuthor = { kind: 'user' } | { kind: 'agent'; scopeRef: string };

/** What the manifest's commit index holds for every committed revision. */
interface RevisionCommit {
  revisionId: string;
  /** Canvas commit sequence, also used as the exclusive pagination cursor. */
  sequence: number;
  author: RevisionAuthor;
  mutationKind: 'create' | 'write' | 'edit' | 'restore';
}

export type RevisionSummary =
  | (RevisionCommit & {
      state: 'saved';
      restoredFromRevisionId?: string;
      createdAt: number;
      designSystem: DesignSystemRef;
      /** Only the head is `building`; an older revision without a build is never built. */
      buildStatus: 'ready' | 'failed' | 'building' | 'unbuilt';
    })
  // Its saved metadata cannot be read; the commit stays listed so paging continues.
  | (RevisionCommit & { state: 'damaged' });

/** What deleting a canvas would end, which the renderer discloses before the user confirms. */
export interface CanvasRemovalPreview {
  canvasId: string;
  name: string;
  /** The canvas's commit sequence, which removeCanvas carries back unchanged. */
  sequence: number;
  /** Chats attached to the canvas; deletion leaves each without one. */
  attachedAppSessionIds: string[];
  /** Chats with an agent turn working on the canvas now; deletion ends that turn's Canvas access. */
  activeTurnAppSessionIds: string[];
  /** Frames whose queued or running build deletion cancels. */
  buildingDesignIds: string[];
}

/** A frame saved to the local library; its source canvas and revision are provenance only. */
export interface LibraryItem {
  itemId: string;
  name: string;
  sourceCanvasId: string;
  source: RevisionRef;
  /** The frame's size on its source canvas when it was saved, in CSS px. */
  width: number;
  height: number;
  designSystem: DesignSystemRef;
}

export interface RevisionDiff {
  from: string;
  to: string;
  /** A truncated file lost diff lines to the total UTF-8 byte cap. */
  files: {
    path: string;
    kind: 'added' | 'removed' | 'modified';
    diff: string;
    truncated: boolean;
  }[];
}

// The stable codes from spec §8. Every failure carries a short recovery message
// and never a stack trace, private path or provider prompt.
export type CanvasErrorCode =
  | 'invalid_input'
  | 'revision_conflict'
  | 'preset_read_only'
  | 'version_mismatch'
  | 'invalid_source_path'
  | 'unsupported_import'
  | 'build_timeout'
  | 'capture_unavailable'
  | 'scope_expired'
  | 'unknown_chat'
  | 'storage_failed'
  | 'stale_revision'
  | 'stale_reference'
  | 'ambiguous_element'
  | 'invalid_edit'
  | 'invalid_source'
  | 'unsupported_edit'
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
  | { type: 'canvas.listAssets'; requestId: string; canvasId: string }
  | { type: 'canvas.attachment'; requestId: string; appSessionId: string }
  | { type: 'canvas.subscribe'; requestId: string; canvasId: string }
  | { type: 'canvas.unsubscribe'; requestId: string; canvasId: string }
  | {
      type: 'canvas.listRevisions';
      requestId: string;
      canvasId: string;
      designId: string;
      page: RevisionPage;
    }
  | {
      type: 'canvas.diffRevisions';
      requestId: string;
      canvasId: string;
      designId: string;
      from: string;
      to: string;
    }
  // A derived read, authorized like `canvas.subscribe` by the page asking: the
  // artifact is a projection of a canvas any renderer page may watch.
  | {
      type: 'canvas.readArtifact';
      requestId: string;
      canvasId: string;
      designId: string;
      revisionId: string;
    }
  // The pane's word on what a preview did, so the agent hears about a design
  // that built and then stopped while rendering. It is never canonical state.
  | { type: 'canvas.reportPreview'; requestId: string; canvasId: string; report: PreviewReport }
  // A source read, authorized like `canvas.subscribe` by the page asking: the
  // source drawer and revision history read a committed revision's files (spec §9).
  | {
      type: 'canvas.readSource';
      requestId: string;
      canvasId: string;
      designId: string;
      revisionId: string;
    }
  | {
      type: 'canvas.createCanvas';
      requestId: string;
      appSessionId: string;
      mutationId: string;
      /** The provisional name the prompt gave it; storage names it otherwise. */
      name?: string;
    }
  | { type: 'canvas.attach'; requestId: string; appSessionId: string; canvasId: string }
  | { type: 'canvas.detach'; requestId: string; appSessionId: string }
  | {
      type: 'canvas.setDesignSystemAdherence';
      requestId: string;
      appSessionId: string;
      canvasId: string;
      designSystemAdherence: DesignSystemAdherence;
    }
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
      type: 'canvas.editElement';
      requestId: string;
      appSessionId: string;
      canvasId: string;
      input: EditElementInput;
    }
  | {
      type: 'canvas.restoreRevision';
      requestId: string;
      appSessionId: string;
      canvasId: string;
      input: RestoreRevisionInput;
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
    }
  | {
      type: 'canvas.annotate';
      requestId: string;
      appSessionId: string;
      canvasId: string;
      input: AnnotateCanvasInput;
    }
  // The Manage design systems dialog (spec §10). Kits are global, not a
  // canvas's, and both saves go through the owner canvas_theme saves through.
  // A new kit is named by its mutationId, so a retry finds the version it saved.
  | { type: 'canvas.listDesignSystems'; requestId: string }
  | { type: 'canvas.readDesignSystem'; requestId: string; ref: DesignSystemVersionRef }
  | {
      type: 'canvas.copyDesignSystem';
      requestId: string;
      mutationId: string;
      source: DesignSystemVersionRef;
      name: string;
    }
  | {
      type: 'canvas.importDesignSystem';
      requestId: string;
      mutationId: string;
      name: string;
      source: DesignSystemSource;
    }
  // The local library (spec §7). A new item is named by its mutationId, so a
  // retried save finds the copy it already made. `thumbnail` is a base64 PNG
  // of that revision, which the item keeps as its own; a listing carries none,
  // so each is read by item.
  | {
      type: 'canvas.saveLibraryItem';
      requestId: string;
      mutationId: string;
      canvasId: string;
      revision: RevisionRef;
      name: string;
      thumbnail?: string;
    }
  | { type: 'canvas.listLibraryItems'; requestId: string; query: string }
  | { type: 'canvas.readLibraryThumbnail'; requestId: string; itemId: string }
  // Explicit whole-canvas deletion from the canvas picker, never an agent tool.
  // The preview names what deleting would end, and removal carries back its
  // sequence and chats so a canvas that changed since is not deleted unseen.
  // A retried removal answers ok.
  | { type: 'canvas.removalPreview'; requestId: string; canvasId: string }
  | {
      type: 'canvas.removeCanvas';
      requestId: string;
      canvasId: string;
      expectedSequence: number;
      expectedAttachedAppSessionIds: string[];
    }
  // A page's answer to an agent's inspect screenshot; only a page that was
  // watching the canvas when it was asked is counted.
  | { type: 'canvas.reportCapture'; requestId: string; captureId: string; capture: CaptureReport };

/**
 * A page's answer to one `canvas.captureRequest`: the base64 PNG its live
 * preview of exactly that revision produced, or why it could not capture it.
 */
type CaptureReport = { ok: true; png: string } | { ok: false; message: string };

/** A canvas an earlier DROIDEX saved in an older format; it is not opened. */
export interface OutdatedCanvas {
  canvasId: string;
  name: string;
}

/** The canvas a chat works on, or null while it is unattached (spec §6). */
interface CanvasAttachment {
  canvasId: string | null;
  /** A canvas an earlier DROIDEX made for this chat, which cannot be opened. */
  outdated?: OutdatedCanvas;
}

/** What a successful command answers with, one kind per command. */
export type CanvasReply =
  | { kind: 'ok' }
  | { kind: 'summaries'; summaries: CanvasSummary[] }
  | { kind: 'assets'; assets: OwnedAsset[] }
  | ({ kind: 'attachment' } & CanvasAttachment)
  | ({ kind: 'canvasCreated' } & CreateCanvasResult)
  | { kind: 'created'; created: CreateFramesResult }
  | { kind: 'written'; receipt: WriteReceipt }
  | ({ kind: 'edited' } & ElementEditResult)
  | { kind: 'arranged'; change: CanvasChange }
  | { kind: 'removed'; undoId: string }
  | { kind: 'undone'; change: CanvasChange }
  | { kind: 'renamed'; change: CanvasChange }
  | { kind: 'annotated'; change: CanvasChange }
  | { kind: 'revisions'; revisions: RevisionSummary[] }
  | { kind: 'revisionDiff'; diff: RevisionDiff }
  | { kind: 'artifact'; artifact: PreviewArtifact | null }
  | { kind: 'source'; files: SourceFiles }
  | { kind: 'designSystems'; systems: DesignSystemSummary[] }
  | { kind: 'designSystem'; system: DesignSystemDetail }
  // Import diagnostics name what could not become a token; unmapped tokens are
  // read from the saved kit instead.
  | { kind: 'designSystemSaved'; ref: DesignSystemVersionRef; diagnostics: CanvasDiagnostic[] }
  | { kind: 'libraryItem'; item: LibraryItem }
  | { kind: 'libraryItems'; items: LibraryItem[] }
  | { kind: 'libraryThumbnail'; png: string | null }
  | { kind: 'removalPreview'; preview: CanvasRemovalPreview };

export type CanvasEvent =
  | { type: 'canvas.result'; requestId: string; ok: true; reply: CanvasReply }
  | { type: 'canvas.result'; requestId: string; ok: false; error: CanvasError }
  // The reply to a subscribe, and the projection every later change extends.
  | { type: 'canvas.snapshot'; requestId: string; snapshot: CanvasSnapshot }
  | { type: 'canvas.summaries'; summaries: CanvasSummary[] }
  // Broadcast with its canvasId, because the bridge server has no per-connection
  // targeting; a client that does not watch that canvas drops it.
  | { type: 'canvas.change'; change: CanvasChange }
  // An agent's inspect screenshot, broadcast for the same reason: every page
  // answers with `canvas.reportCapture`, and only those watching the canvas count.
  | {
      type: 'canvas.captureRequest';
      captureId: string;
      canvasId: string;
      designId: string;
      revisionId: string;
    };
