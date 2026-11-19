import type { RevisionRef } from './canvas-state.js';
import type { DocumentSection } from './design-system-document.js';

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
 * version or a waiting proposal, or a catalog entry by its name with the
 * options picked for its props, which a saved version alone answers for.
 */
export type KitPreviewTarget =
  | { kind: 'preview'; ref: DesignSystemRef | DesignSystemProposalRef; item: string }
  | { kind: 'catalog'; ref: DesignSystemRef; entry: string; props: PropPick[] };

/** What a kit capture shows: a preview by its id or `cover`, or a catalog entry at its defaults. */
export type KitCaptureItem = string | { entry: string };

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
  /**
   * Files it kept whose exports the kit entry does not all re-export
   * (no_exports, duplicate_export) or whose catalog demo it left out (demo_left_out).
   */
  partialCount: number;
}

/**
 * A file a library import left out, or kept with exports the kit entry does
 * not take or without its catalog demo. `detail` names the import, the
 * left-out sibling, the exports another file gave the entry or the variant
 * the library lacks, for the four reasons that have one.
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
  | 'not_a_component'
  | 'demo_left_out';

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

/** One entry of a kit's catalog, as the kit document lists it. */
export interface CatalogListing {
  name: string;
  /** The kit file it shows, for grouping and search. */
  module: string | null;
  note: string | null;
  /** The props the Components tab lets the user pick before it adds the entry. */
  props: CatalogProp[];
}

/** An attribute of an entry's element and the options it can take, `default` the one it writes. */
export interface CatalogProp {
  name: string;
  options: string[];
  default: string;
}

/** One of a catalog entry's props, and the option picked for it. */
export interface PropPick {
  name: string;
  value: string;
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
  /** The chat whose agent proposed it, never a provider session. */
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
