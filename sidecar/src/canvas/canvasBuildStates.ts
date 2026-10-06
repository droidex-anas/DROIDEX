// What every design's build is doing, keyed by its canvas as well as its own ID
// because two manifests may hold the same design ID. `CanvasBuilds` is the only
// writer; frame projections read it through the `BuildStates` port. The attempt
// number lives here too: it only ever increases for a design, which is what
// lets a published result prove it was the attempt the frame still wanted.

import type { RestoredBuild } from './canvasBuildCache.js';
import type { CanvasBuildState } from './protocol.js';

const PENDING: CanvasBuildState = { status: 'pending' };

interface DesignBuild {
  state: CanvasBuildState;
  generation: number;
}

export class CanvasBuildStates {
  private readonly byDesign = new Map<string, DesignBuild>();

  /** The state every frame projection reads; an unknown design is pending. */
  stateOf(canvasId: string, designId: string): CanvasBuildState {
    return this.byDesign.get(designKey(canvasId, designId))?.state ?? PENDING;
  }

  /** Records a state against the attempt the design is already on. */
  set(canvasId: string, designId: string, state: CanvasBuildState): void {
    const key = designKey(canvasId, designId);
    const generation = this.byDesign.get(key)?.generation ?? 0;
    this.byDesign.set(key, { generation, state });
  }

  /** Opens the next attempt on a revision, records it, and names it. */
  nextAttempt(canvasId: string, designId: string, revisionId: string): number {
    const key = designKey(canvasId, designId);
    const generation = (this.byDesign.get(key)?.generation ?? 0) + 1;
    this.byDesign.set(key, { generation, state: { status: 'building', revisionId, generation } });
    return generation;
  }

  /** Forgets a design whose frame has left its canvas. */
  forget(canvasId: string, designId: string): void {
    this.byDesign.delete(designKey(canvasId, designId));
  }

  /** Installs what the derived cache proved when the workspace opened. */
  install(restored: readonly RestoredBuild[]): void {
    for (const entry of restored) {
      this.byDesign.set(designKey(entry.canvasId, entry.designId), {
        state: entry.state,
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
