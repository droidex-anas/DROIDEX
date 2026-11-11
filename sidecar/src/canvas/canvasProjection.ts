// The wire values a canvas's manifest projects: its frames, with the build state
// `CanvasBuilds` owns, the snapshot and summary a pane reads, and the change a
// commit publishes.

import type { CanvasManifest, PersistedDesign } from './canvasManifest.js';
import type {
  CanvasBuildState,
  CanvasChange,
  CanvasFrame,
  CanvasSnapshot,
  CanvasSummary,
} from './protocol.js';

/** Where a frame's build state comes from: `CanvasBuilds` is its one owner. */
export interface BuildStates {
  stateOf(canvasId: string, designId: string): CanvasBuildState;
}

export function toFrame(
  canvasId: string,
  design: PersistedDesign,
  builds: BuildStates,
): CanvasFrame {
  return {
    designId: design.designId,
    name: design.name,
    rect: { ...design.rect },
    layoutVersion: design.layoutVersion,
    manifestVersion: design.manifestVersion,
    revisionId: design.revisionId,
    designSystem: { ...design.designSystem },
    variantOf: design.variantOf ?? null,
    seededRevisionId: design.seededRevisionId ?? null,
    hidden: design.hidden === true,
    build: builds.stateOf(canvasId, design.designId),
  };
}

export function canvasSnapshot(manifest: CanvasManifest, builds: BuildStates): CanvasSnapshot {
  return {
    canvasId: manifest.canvasId,
    sequence: manifest.sequence,
    frames: manifest.designs.map((design) => toFrame(manifest.canvasId, design, builds)),
    annotationsVersion: manifest.annotationsVersion,
    annotations: [...manifest.annotations],
  };
}

export function canvasSummary(manifest: CanvasManifest): CanvasSummary {
  return {
    canvasId: manifest.canvasId,
    name: manifest.name,
    updatedAt: manifest.updatedAt,
    designCount: manifest.designs.length,
    attachedAppSessionIds: [...manifest.attachedAppSessionIds],
    designSystemAdherence: manifest.designSystemAdherence,
  };
}

export function canvasChange(
  manifest: CanvasManifest,
  designs: readonly PersistedDesign[],
  builds: BuildStates,
): CanvasChange {
  return {
    canvasId: manifest.canvasId,
    sequence: manifest.sequence,
    frames: designs.map((design) => toFrame(manifest.canvasId, design, builds)),
    removedDesignIds: [],
  };
}
