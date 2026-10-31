// What every design's build is doing, keyed by its canvas as well as its own ID
// because two manifests may hold the same design ID. `CanvasBuilds` is the only
// writer; frame projections read it through the `BuildStates` port. The attempt
// number lives here too: it only ever increases for a design, which is what
// lets a published result prove it was the attempt the frame still wanted.

import type { RestoredBuild } from './canvasBuildCache.js';
import type { CanvasBuildOutcome, CanvasBuildState } from './protocol.js';

/** Nothing has been attempted for a design this registry has never heard of. */
const UNKNOWN: CanvasBuildState = { status: 'pending', generation: 0 };

interface DesignBuild {
  outcome: CanvasBuildOutcome;
  generation: number;
}

export class CanvasBuildStates {
  private readonly byDesign = new Map<string, DesignBuild>();

  /**
   * The state every frame projection reads, carrying the attempt it belongs to;
   * an unknown design is pending on attempt zero.
   */
  stateOf(canvasId: string, designId: string): CanvasBuildState {
    const held = this.byDesign.get(designKey(canvasId, designId));
    return held ? { ...held.outcome, generation: held.generation } : UNKNOWN;
  }

  /** Records an outcome against the attempt the design is already on. */
  set(canvasId: string, designId: string, outcome: CanvasBuildOutcome): void {
    const key = designKey(canvasId, designId);
    const generation = this.byDesign.get(key)?.generation ?? 0;
    this.byDesign.set(key, { generation, outcome });
  }

  /** Opens the next attempt on a revision, records it, and names it. */
  nextAttempt(canvasId: string, designId: string, revisionId: string): number {
    const key = designKey(canvasId, designId);
    const generation = (this.byDesign.get(key)?.generation ?? 0) + 1;
    this.byDesign.set(key, { generation, outcome: { status: 'building', revisionId } });
    return generation;
  }

  /** Forgets a design whose frame has left its canvas. */
  forget(canvasId: string, designId: string): void {
    this.byDesign.delete(designKey(canvasId, designId));
  }

  /**
   * Installs what the derived cache proved when the workspace opened. A restored
   * outcome is attempt zero: nothing has been built in this session, so the first
   * rebuild of that design takes attempt one and a reader sees the move.
   */
  install(restored: readonly RestoredBuild[]): void {
    for (const entry of restored) {
      this.byDesign.set(designKey(entry.canvasId, entry.designId), {
        outcome: entry.outcome,
        generation: 0,
      });
    }
  }

  clear(): void {
    this.byDesign.clear();
  }
}

/** One design on one canvas: the identity its state and its queued job share. */
export function designKey(canvasId: string, designId: string): string {
  return `${canvasId}/${designId}`;
}
