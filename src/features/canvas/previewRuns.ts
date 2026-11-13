// The one preview each design on a board is running, as its guest attached.
// The board keeps one for its lifetime, so every tool that asks a design's
// guest something reaches the same run, and a view that lists what the runs
// can answer subscribes to hear when one comes or goes.

import type { PreviewRun } from './previewRuntime';

export interface AttachedRun {
  revisionId: string;
  run: PreviewRun;
}

export class PreviewRuns {
  private readonly byDesign = new Map<string, AttachedRun>();
  private readonly listeners = new Set<() => void>();
  /** Counts every change, so a subscriber can tell one happened. */
  version = 0;

  get(designId: string): AttachedRun | undefined {
    return this.byDesign.get(designId);
  }

  /** Makes `run` the design's preview, in place of the one it had. */
  set(designId: string, revisionId: string, run: PreviewRun): void {
    this.byDesign.set(designId, { revisionId, run });
    this.changed();
  }

  /**
   * Forgets `run` unless a replacement has already taken its design, and
   * answers whether it was still the design's preview.
   */
  release(designId: string, run: PreviewRun): boolean {
    if (this.byDesign.get(designId)?.run !== run) return false;
    this.byDesign.delete(designId);
    this.changed();
    return true;
  }

  /** Calls `listener` after each set or release; the call returned stops it. */
  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  private changed(): void {
    this.version += 1;
    for (const listener of this.listeners) listener();
  }
}
