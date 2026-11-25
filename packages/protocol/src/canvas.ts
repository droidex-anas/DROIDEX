import type {
  ArrangeFramesInput,
  CanvasError,
  CreateFramesInput,
  RemoveFramesInput,
  RenameFrameInput,
  ReorderFramesInput,
  RevisionDiff,
  RevisionPage,
  RevisionSummary,
  SetFrameHiddenInput,
  SwitchRevisionInput,
  UndoRemovalInput,
  WriteFilesInput,
} from './canvas-mutations.js';
import type {
  CanvasAttachment,
  CanvasChange,
  CanvasDiagnostic,
  CanvasSnapshot,
  CanvasSummary,
  CreateCanvasResult,
  CreateFramesResult,
  DesignSystemAdherence,
  KitFontFace,
  KitPreview,
  OwnedAsset,
  PreviewArtifact,
  PreviewReport,
  RevisionRef,
  SourceFiles,
  WriteReceipt,
} from './canvas-state.js';
import type { EditElementInput } from './element-edits.js';
import type { AnnotateCanvasInput } from './annotations.js';
import type {
  CanvasRemovalPreview,
  DesignSystemCover,
  DesignSystemDocumentView,
  DesignSystemVersionContent,
  DesignSystemRef,
  DesignSystemSource,
  DesignSystemSummary,
  DesignSystemVersionEntry,
  DesignSystemVersionRef,
  EditToken,
  KitCaptureItem,
  KitPreviewTarget,
  LibraryItem,
} from './design-systems.js';
import type { DocumentSection } from './design-system-document.js';

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
  | {
      type: 'canvas.readDesignSystemVersionContent';
      requestId: string;
      ref: DesignSystemVersionRef;
    }
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
  // base64 PNG taken from a saved version's live preview or catalog entry; a
  // later one replaces it.
  | { type: 'canvas.readKitPreview'; requestId: string; target: KitPreviewTarget }
  | {
      type: 'canvas.saveKitCapture';
      requestId: string;
      ref: DesignSystemRef;
      item: KitCaptureItem;
      png: string;
    }
  | {
      type: 'canvas.readKitCapture';
      requestId: string;
      ref: DesignSystemRef;
      item: KitCaptureItem;
    }
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
  | { kind: 'designSystemVersionContent'; content: DesignSystemVersionContent }
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
