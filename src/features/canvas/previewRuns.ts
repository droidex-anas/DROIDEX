// The one preview each design on a board is running, as its guest attached.
// The board keeps one for its lifetime, so every tool that asks a design's
// guest something reaches the same run.

import type { PreviewRun } from './previewRuntime';

export interface AttachedRun {
  revisionId: string;
  run: PreviewRun;
}

export class PreviewRuns {
  private readonly byDesign = new Map<string, AttachedRun>();

  get(designId: string): AttachedRun | undefined {
    return this.byDesign.get(designId);
  }

  /** Makes `run` the design's preview, in place of the one it had. */
  set(designId: string, revisionId: string, run: PreviewRun): void {
    this.byDesign.set(designId, { revisionId, run });
  }

  /**
   * Forgets `run` unless a replacement has already taken its design, and
   * answers whether it was still the design's preview.
   */
  release(designId: string, run: PreviewRun): boolean {
    if (this.byDesign.get(designId)?.run !== run) return false;
    this.byDesign.delete(designId);
    return true;
  }
}
