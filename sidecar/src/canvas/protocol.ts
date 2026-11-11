// Canvas wire DTOs. Mutation inputs are defined once by the Zod parsers in
// schema.ts, frameEditSchema.ts and elementEditSchema.ts and re-exported here; the renderer keeps a
// hand-written mirror at src/features/canvas/protocol.ts, and schema.test.ts
// stops compiling when the two drift.

import type {
  ArrangeFramesInput,
  RemoveFramesInput,
  RenameFrameInput,
  ReorderFramesInput,
  SetFrameHiddenInput,
  UndoRemovalInput,
} from './frameEditSchema.js';
import type {
  CanvasTurnContext,
  CreateCanvasResult,
  CreateFramesInput,
  DesignSystemAdherence,
  DesignSystemRef,
  DesignSystemVersionRef,
  FrameRect,
  SwitchRevisionInput,
  RevisionPage,
  RevisionRef,
  SourceFiles,
  WriteFilesInput,
} from './schema.js';
import type { EditElementInput } from './elementEditSchema.js';
import type {
  AnnotateCanvasInput,
  Annotation,
  AnnotationChange,
} from './canvasAnnotationSchema.js';
import type { DocumentSection } from './designSystemDocument.js';
import type { DesignSystemDocumentView } from './designSystemCommands.js';
import type { EditToken } from './styleEdits.js';
import type { KitFontFace } from './kitFonts.js';
import type { KitPreview } from './kitPreviews.js';
import type {
  DesignSystemCover,
  DesignSystemSource,
  DesignSystemSummary,
  DesignSystemVersionEntry,
} from './designSystems.js';

export type {
  ArrangeFramesInput,
  RemoveFramesInput,
  RenameFrameInput,
  UndoRemovalInput,
} from './frameEditSchema.js';
export type { EditElementInput } from './elementEditSchema.js';
export type {
  CanvasTurnContext,
  CreateCanvasResult,
  CreateFramesInput,
  DesignRef,
  DesignSystemAdherence,
  DesignSystemRef,
  DesignSystemVersionRef,
  ElementRef,
  FrameRect,
  SwitchRevisionInput,
  RevisionPage,
  RevisionRef,
  SourceFiles,
  WriteFilesInput,
} from './schema.js';

export type ElementEdit = EditElementInput['edit'];

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
  /** The 1-based line `start` is on, for display; the offsets are what locate the element. */
  line: number;
  tagName: string;
  /** The capitalised function it is written in, as React names a component; null outside one. */
  component: string | null;
  editability: 'literal' | 'computed' | 'shared';
}

/** One row of a design's source outline: something written in its source, nested as written. */
export interface OutlineNode {
  /** Unique within its outline: an element opened through two instances is two rows. */
  nodeId: string;
  /** Null for a row the root component renders directly. */
  parentId: string | null;
  kind: 'element' | 'instance' | 'repeat' | 'condition';
  /** The tag, the component's name, 'Repeat' or 'Condition'. */
  name: string;
  /** An element's own literal text, on one line, 64 code points at most. */
  text: string | null;
  /** The element's marker; null for the other kinds. */
  elementId: string | null;
  /** Why it cannot be edited directly: in a repeat, rendered several times, worked out in code, or the kit's. */
  lock: 'repeated' | 'shared' | 'computed' | 'kit' | null;
  /** A direct JSX child, so it can be moved, removed or copied as a whole. */
  free: boolean;
}

/** What a design's root renders, in reading order, and whether it stopped at a cap. */
export interface SourceOutline {
  nodes: OutlineNode[];
  truncated: boolean;
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
      outline: SourceOutline;
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
 * One design's build state and the attempt it belongs to. `generation` counts
 * the design's build attempts and only goes up: the sidecar publishes a result
 * only while its attempt is the latest, and the renderer takes a new generation
 * as a new build even when identical source rebuilt to the same artifact.
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
  mediaType: 'image/png' | 'image/jpeg' | 'image/webp' | 'image/svg+xml';
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
  /** The frame this one is a variant of; its set is every frame naming the same one. */
  variantOf: string | null;
  /** The copy its seed made; while `revisionId` is this one, nobody has changed it. */
  seededRevisionId: string | null;
  /** The user hid it from the board; an agent still reads and writes it. */
  hidden: boolean;
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

/** A frame as a change reports it: its build travels apart, and only when it changed. */
export type ChangedFrame = Omit<CanvasFrame, 'build'>;

interface FrameBuild {
  designId: string;
  build: CanvasBuildState;
}

export interface CanvasChange {
  canvasId: string;
  sequence: number;
  frames: ChangedFrame[];
  /** The builds this change moved; a frame new to the canvas always has its build here. */
  builds: FrameBuild[];
  removedDesignIds: string[];
  /** Present only on a change that touched the annotation layer. */
  annotations?: AnnotationChange;
  /** Present only on a reorder: every frame's designId, back to front. */
  order?: string[];
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
  // Told once, by the create that drew them; a retry's recorded answer lacks it.
  svgAsImage?: { designId: string; reason: SvgImageReason }[];
}

/** Why a frame seeded from an SVG draws it as an `<img>` instead of inline JSX. */
export type SvgImageReason = 'too_large' | 'stylesheet';

export interface WriteReceipt {
  designId: string;
  revisionId: string;
  sequence: number;
}

export type RevisionAuthor = { kind: 'user' } | { kind: 'agent'; scopeRef: string };

/** What the manifest's commit index holds for every committed revision. */
interface RevisionCommit {
  revisionId: string;
  /** 1 for the design's first revision; it never changes. */
  version: number;
  /** Canvas commit sequence, also used as the exclusive pagination cursor. */
  sequence: number;
  author: RevisionAuthor;
  /** `restore` only on revisions an earlier DROIDEX's Restore wrote. */
  mutationKind: 'create' | 'write' | 'edit' | 'restore';
}

export type RevisionSummary =
  | (RevisionCommit & {
      state: 'saved';
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
  /** The kit's newest version, when a design system save names an older base. */
  latestVersion?: number;
}

/** The proposal a kit has waiting, in one mode; a new proposal gets a new `proposalId`. */
export interface DesignSystemProposalRef {
  id: string;
  proposalId: string;
  mode: DesignSystemRef['mode'];
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
      type: 'canvas.switchRevision';
      requestId: string;
      appSessionId: string;
      canvasId: string;
      input: SwitchRevisionInput;
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
      type: 'canvas.setFrameHidden';
      requestId: string;
      appSessionId: string;
      canvasId: string;
      input: SetFrameHiddenInput;
    }
  | {
      type: 'canvas.reorderFrames';
      requestId: string;
      appSessionId: string;
      canvasId: string;
      input: ReorderFramesInput;
    }
  | {
      type: 'canvas.annotate';
      requestId: string;
      appSessionId: string;
      canvasId: string;
      input: AnnotateCanvasInput;
    }
  // The design system document (design system documents spec §14). Kits are
  // global, not a canvas's, and every save goes through the owner canvas_theme
  // saves through. A save names the version it edited and is refused, writing
  // nothing, once that is not the newest. A new kit is named by its mutationId,
  // so a retry finds the version it saved.
  | { type: 'canvas.listDesignSystems'; requestId: string }
  | { type: 'canvas.readDesignSystem'; requestId: string; ref: DesignSystemVersionRef }
  | { type: 'canvas.readEditTokens'; requestId: string; ref: DesignSystemVersionRef }
  | {
      type: 'canvas.saveDesignSystem';
      requestId: string;
      mutationId: string;
      id: string;
      baseVersion: number;
      name: string;
      cover: DesignSystemCover;
      sections: DocumentSection[];
    }
  | { type: 'canvas.listDesignSystemVersions'; requestId: string; id: string }
  | {
      type: 'canvas.restoreDesignSystemVersion';
      requestId: string;
      mutationId: string;
      id: string;
      version: number;
      /** The newest version the user saw; the restored copy goes on top of it. */
      onto: number;
    }
  | {
      type: 'canvas.setDesignSystemDeleted';
      requestId: string;
      mutationId: string;
      id: string;
      deleted: boolean;
    }
  // The agent proposal the user reviewed, while it is still the one waiting:
  // accept saves it as the version after `onto`, the newest the user saw, and
  // discard removes it.
  | {
      type: 'canvas.acceptDesignSystemProposal';
      requestId: string;
      mutationId: string;
      id: string;
      proposalId: string;
      onto: number;
    }
  | {
      type: 'canvas.discardDesignSystemProposal';
      requestId: string;
      id: string;
      proposalId: string;
    }
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
  // A kit version's previews in one mode, or a waiting proposal's. `item` is a
  // preview's id or `cover`. A capture is a base64 PNG the document took from a
  // saved version's live preview; a later one replaces it.
  | {
      type: 'canvas.readKitPreview';
      requestId: string;
      ref: DesignSystemRef | DesignSystemProposalRef;
      item: string;
    }
  | {
      type: 'canvas.saveKitCapture';
      requestId: string;
      ref: DesignSystemRef;
      item: string;
      png: string;
    }
  | { type: 'canvas.readKitCapture'; requestId: string; ref: DesignSystemRef; item: string }
  // The fonts a kit version's stylesheets embed, which its document sets the kit's words in.
  | { type: 'canvas.readKitFonts'; requestId: string; ref: DesignSystemVersionRef }
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
  // The picture a canvas's Design home card shows: a base64 PNG of its first
  // frame, which the pane captures and each later save replaces.
  | { type: 'canvas.saveCover'; requestId: string; canvasId: string; png: string }
  | { type: 'canvas.readCover'; requestId: string; canvasId: string }
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
  // A page's answer to an agent's screenshot or render; only a page that was
  // watching the canvas when it was asked is counted.
  | { type: 'canvas.reportCapture'; requestId: string; captureId: string; capture: CaptureReport };

/**
 * What a capture asks a page for: a PNG at a scale, where null is the page's
 * display scale, or a vector design's own root `<svg>`.
 */
export type CaptureImage = { format: 'png'; scale: 1 | 2 | 3 | null } | { format: 'svg' };

/**
 * A page's answer to one `canvas.captureRequest`: the base64 PNG or the SVG
 * its live preview of exactly that revision produced, or why it could not.
 */
type CaptureReport =
  | { ok: true; png: string }
  | { ok: true; svg: string }
  | { ok: false; message: string };

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
  /** A direct edit's revision, and the nodeId of the row a layer edit lands on in it (the moved layer, its copy, or the row a removed one leaves the keyboard to); null for any other edit, or a replay. */
  | { kind: 'edited'; receipt: WriteReceipt; landed: string | null }
  | { kind: 'arranged'; change: CanvasChange }
  | { kind: 'removed'; undoId: string }
  | { kind: 'undone'; change: CanvasChange }
  | { kind: 'renamed'; change: CanvasChange }
  | { kind: 'hiddenSet'; change: CanvasChange }
  | { kind: 'reordered'; change: CanvasChange }
  | { kind: 'annotated'; change: CanvasChange }
  | { kind: 'revisions'; revisions: RevisionSummary[] }
  | { kind: 'revisionDiff'; diff: RevisionDiff }
  | { kind: 'artifact'; artifact: PreviewArtifact | null }
  | { kind: 'source'; files: SourceFiles }
  | { kind: 'designSystems'; systems: DesignSystemSummary[] }
  | { kind: 'designSystem'; system: DesignSystemDocumentView }
  | { kind: 'editTokens'; tokens: Record<string, EditToken[]> }
  | { kind: 'designSystemVersions'; versions: DesignSystemVersionEntry[] }
  // Import diagnostics name what could not become a token; unmapped tokens are
  // read from the saved kit instead.
  | { kind: 'designSystemSaved'; ref: DesignSystemVersionRef; diagnostics: CanvasDiagnostic[] }
  | { kind: 'kitPreview'; preview: KitPreview }
  | { kind: 'kitCapture'; png: string | null }
  | { kind: 'kitFonts'; faces: KitFontFace[] }
  | { kind: 'libraryItem'; item: LibraryItem }
  | { kind: 'libraryItems'; items: LibraryItem[] }
  | { kind: 'libraryThumbnail'; png: string | null }
  | { kind: 'cover'; png: string | null }
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
      image: CaptureImage;
    }
  // After any write to a kit, so every open list and document reads it again.
  | { type: 'canvas.designSystemsChanged'; id: string };
