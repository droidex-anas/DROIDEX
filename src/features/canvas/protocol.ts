// Canvas wire DTOs, mirrored by hand from sidecar/src/canvas/protocol.ts — keep
// them in sync. The renderer cannot import sidecar source and has no Zod, so
// this file carries no validation: the sidecar owns the boundary, and
// sidecar/src/canvas/schema.test.ts stops compiling when the two drift.
//
// CanvasScope is the sidecar's turn lease and is deliberately absent here; the
// renderer only ever sends the pinned CanvasTurnContext beside its prompt.

import type { AnnotateCanvasInput, Annotation, AnnotationChange } from './annotationProtocol';
import type { DocumentSection } from './designSystemDocumentProtocol';
import type { EditElementInput } from './elementEditProtocol';

export interface DesignSystemRef {
  id: string;
  version: number;
  mode: 'light' | 'dark';
}

/** One immutable kit version, without the mode a design previews it in. */
export interface DesignSystemVersionRef {
  id: string;
  version: number;
}

/** The proposal a kit has waiting, in one mode; a new proposal gets a new `proposalId`. */
export interface DesignSystemProposalRef {
  id: string;
  proposalId: string;
  mode: DesignSystemRef['mode'];
}

/**
 * What a kit preview shows: a preview by its id or `cover`, from a saved
 * version or a waiting proposal, or a catalog entry by its name, which a saved
 * version alone answers for.
 */
export type KitPreviewTarget =
  | { kind: 'preview'; ref: DesignSystemRef | DesignSystemProposalRef; item: string }
  | { kind: 'catalog'; ref: DesignSystemRef; entry: string };

/** A row of the design-system list: Auto, the presets, then each user kit's latest version. */
export interface DesignSystemSummary {
  id: string;
  version: number;
  name: string;
  kind: 'auto' | 'preset' | 'user';
  swatches: {
    light: { surface: string; accent: string };
    dark: { surface: string; accent: string };
  };
  cover: boolean;
  /** When the listed version was saved; a built-in kit was never saved. */
  savedAt: string | null;
  /** Whether an agent proposal waits for review. */
  proposal: boolean;
}

/** A kit's visual: a preview of one of its examples, or an image the user chose. */
export type DesignSystemCover =
  | { kind: 'preview'; example: string }
  | { kind: 'image'; assetId: string }
  | null;

export type SavedBy = { actor: 'user' } | { actor: 'agent'; appSessionId: string };

/** One saved version as the version history lists it. */
export interface DesignSystemVersionEntry {
  version: number;
  savedAt: string;
  savedBy: SavedBy;
}

export type DesignSystemProvenance =
  | { sourceCanvasId: string; revision: { designId: string; revisionId: string } }
  | { copiedFrom: { id: string; version: number } }
  | { project: { name: string; files: string[]; library?: LibraryProvenance } };

/** A kit read from a component library in the project, and the project names it kept. */
export interface LibraryProvenance {
  kind: 'shadcn';
  /** Each primitive the kit exports, and the project module it came from. */
  components: Record<string, string>;
  /** Each kit token, and the project token it was read from. */
  tokens: Record<string, string>;
  /** The import's review, by file, up to 128 records; the counts have them all. */
  skipped: LibrarySkip[];
  /** Files the import left out of the kit. */
  skippedCount: number;
  /** Files it kept whose exports the kit entry does not all re-export (no_exports, duplicate_export). */
  partialCount: number;
}

/**
 * A file a library import left out, or kept with exports the kit entry does
 * not take. `detail` names the import, the left-out sibling or the exports
 * another file gave the entry, for the three reasons that have one.
 */
export interface LibrarySkip {
  file: string;
  reason: LibrarySkipReason;
  detail: string | null;
}

export type LibrarySkipReason =
  | 'over_limit'
  | 'unreadable'
  | 'unsupported_import'
  | 'needs_left_out'
  | 'duplicate_export'
  | 'no_exports'
  | 'not_a_component';

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

/** One kit token a direct style edit may name, with its value in each mode. */
export type EditToken = { name: string } & ({ value: string } | { light: string; dark: string });

/** One insertable entry of a kit's catalog, as the kit document lists it. */
export interface CatalogListing {
  name: string;
  /** The kit file it shows, for grouping and search. */
  module: string | null;
  note: string | null;
}

/** A kit version as its document shows it: everything but its source. */
export interface DesignSystemDocumentView {
  id: string;
  version: number;
  /** The kit's newest version, which a save must build on. */
  latestVersion: number;
  name: string;
  kind: DesignSystemSummary['kind'];
  cover: DesignSystemCover;
  sections: DocumentSection[];
  /** The example file names its previews may name. */
  examples: string[];
  /** The entries of the kit's catalog.json, in its order. */
  catalog: CatalogListing[];
  /** Tokens a kit built on the shared primitives has beyond the ones they read. */
  unmapped: string[];
  provenance: DesignSystemProvenance | null;
  /** When and by whom this version was saved; a built-in kit was never saved. */
  savedAt: string | null;
  savedBy: SavedBy | null;
  /** The agent proposal waiting for review, if there is one. */
  proposal: DesignSystemProposal | null;
}

/** A kit's pending agent proposal: the version it was made on and the document it proposes. */
export interface DesignSystemProposal {
  /** A proposal is never changed, only replaced by one with another ID. */
  proposalId: string;
  baseVersion: number;
  proposedAt: string;
  /** The chat whose agent proposed it. */
  appSessionId: string;
  /** A proposal may rename the kit. */
  name: string;
  cover: DesignSystemCover;
  sections: DocumentSection[];
}

/** A new kit's source from the dialog's New menu. */
export interface DesignSystemSource {
  kind: 'designMd' | 'cssOrTailwind';
  text: string;
}

/** How a canvas holds its designs to their pinned kit; `guide` is the default. */
export type DesignSystemAdherence = 'off' | 'guide' | 'strict';

export interface CreateCanvasResult {
  /** The canvas this mutation originally created, unchanged by a replay. */
  canvasId: string;
  /** The chat's attachment when this request settled; only this updates its cache. */
  attachedCanvasId: string | null;
}

/** A canvas an earlier DROIDEX saved in an older format; it is not opened. */
export interface OutdatedCanvas {
  canvasId: string;
  name: string;
}

/** The canvas a chat works on, or null while it is unattached (spec §6). */
export interface CanvasAttachment {
  canvasId: string | null;
  /** A canvas an earlier DROIDEX made for this chat, which cannot be opened. */
  outdated?: OutdatedCanvas;
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
  | { kind: 'library'; itemId: string }
  | { kind: 'svg'; assetId: string };

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
  /** Owned images attached as references; absent when there are none. */
  images?: { assetId: string }[];
}

/**
 * One built revision's preview document and the ID of that document. A preview
 * loads this in its guest; nothing else reads it.
 */
export interface PreviewArtifact {
  artifactId: string;
  html: string;
}

/** What a kit preview tile loads, or the diagnostics it shows instead. */
export type KitPreview =
  | { status: 'ready'; artifact: PreviewArtifact }
  | { status: 'failed'; diagnostics: CanvasDiagnostic[] };

/** One `@font-face` a kit declares, its descriptors as written and its WOFF2 file as base64. */
export interface KitFontFace {
  family: string;
  style: string;
  weight: string;
  unicodeRange: string;
  woff2: string;
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

export interface OwnedAsset {
  assetId: string;
  mediaType: 'image/png' | 'image/jpeg' | 'image/webp' | 'image/svg+xml';
  byteLength: number;
  width: number;
  height: number;
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
  /** An element whose props set or may set its content, so it takes no written children. */
  contentFromProps: boolean;
  /**
   * An element is 'shown' unless Tailwind's `hidden` class hides it ('hidden'),
   * or the layers panel can't tell or change whether it shows: its classes or
   * props come from code ('computed'), a class or style decides its display
   * ('display'), or a `hidden` attribute does ('attribute'). Other kinds are 'shown'.
   */
  visibility: 'shown' | 'hidden' | 'computed' | 'display' | 'attribute';
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
  svgAsImage?: { designId: string; reason: 'too_large' | 'stylesheet' }[];
}

export interface WriteReceipt {
  designId: string;
  revisionId: string;
  sequence: number;
}

export interface CreateFramesInput {
  mutationId: string;
  placeBeside?: { designId: string };
  frames: {
    name: string;
    width: number;
    height: number;
    designSystem: DesignSystemRef;
    seed?: CanvasSeed;
    variantOf?: string;
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

export interface RevisionPage {
  limit: number;
  before?: number;
}

export interface SwitchRevisionInput {
  mutationId: string;
  designId: string;
  revisionId: string;
  expectedRevisionId: string | null;
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

export interface SetFrameHiddenInput {
  mutationId: string;
  designId: string;
  hidden: boolean;
  expectedManifestVersion: number;
}

/** The whole stacking order, back to front, naming each frame on the canvas once. */
export interface ReorderFramesInput {
  mutationId: string;
  designIds: string[];
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

// ── Bridge commands and events ───────────────────────────────────────
// `appSessionId` is the only session identity on the wire. A mutation names the
// canvas its chat is attached to, and the sidecar refuses one that disagrees.

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
  // global, not a canvas's. A save names the version it edited and is refused,
  // writing nothing, once that is not the newest. A new kit is named by its
  // mutationId, so a retry finds the version it already saved.
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
  // One preview of a kit in one mode, as its target names it. A capture is a
  // base64 PNG the document took from a saved version's live preview; a later
  // one replaces it, and its `item` names a preview as a preview target does.
  | { type: 'canvas.readKitPreview'; requestId: string; target: KitPreviewTarget }
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
export type CaptureReport =
  | { ok: true; png: string }
  | { ok: true; svg: string }
  | { ok: false; message: string };

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
