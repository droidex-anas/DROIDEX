import type { CanvasFrame, DesignSystemAdherence, RevisionRef, SourceFiles } from './protocol.js';

/** What a build pins its result to, as the canvas stands right now. */
export interface BuildTarget {
  frame: CanvasFrame;
  /** The revision this design falls back to, as the manifest records it. */
  lastWorkingRevisionId: string | null;
  /** The canvas's rule for holding designs to their kit. */
  designSystemAdherence: DesignSystemAdherence;
}

/**
 * What a published build asks the manifest to keep: a state-only commit leaves
 * the fallback alone, an outcome names the revision the design now falls back to.
 */
export type BuildCommit = (
  | { kind: 'state' }
  | { kind: 'outcome'; lastWorkingRevisionId: string | null }
) & {
  /** Rechecked after manifest staging, immediately before canonical publication. */
  isCurrent(): boolean;
};

/** The workspace boundary a build registry publishes through. */
export interface CanvasBuildHost {
  buildTarget(canvasId: string, designId: string): BuildTarget | null;
  readFiles(canvasId: string, ref: RevisionRef): Promise<SourceFiles>;
  /**
   * Runs `publish` with the head held still and carries its gate through
   * manifest staging. Never rejects; the workspace reports failed commits.
   */
  commitBuild(
    canvasId: string,
    designId: string,
    publish: () => Promise<BuildCommit | null>,
  ): Promise<void>;
}
