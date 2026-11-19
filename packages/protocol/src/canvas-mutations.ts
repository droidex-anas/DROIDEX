import type { DesignSystemRef } from './design-systems.js';
import type { CanvasSeed, FrameRect, SourceFiles } from './canvas-state.js';

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
export interface RevisionCommit {
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
