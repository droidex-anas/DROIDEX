// What a retried mutation answers: the result its first run recorded in the
// manifest's ledger, never today's state, so a retry after a lost response
// cannot tell the caller something its original request did not do.

import { findMutation, toFrame, type BuildStates, type CanvasManifest } from './canvasManifest.js';
import type { CanvasChange, CreateFramesResult, WriteReceipt } from './protocol.js';

export function recordedCreate(
  manifest: CanvasManifest,
  mutationId: string,
  fingerprint: string,
  builds: BuildStates,
): CreateFramesResult | null {
  const record = findMutation(manifest, mutationId, 'create', fingerprint);
  if (record?.kind !== 'create') return null;
  return {
    canvasId: manifest.canvasId,
    frames: record.designs.map((design) => toFrame(manifest.canvasId, design, builds)),
  };
}

/** The original receipt for a source mutation. */
export function recordedRevision(
  manifest: CanvasManifest,
  mutationId: string,
  kind: 'write' | 'edit' | 'restore',
  fingerprint: string,
): WriteReceipt | null {
  const record = findMutation(manifest, mutationId, kind, fingerprint);
  if (record?.kind !== 'write' && record?.kind !== 'edit' && record?.kind !== 'restore')
    return null;
  return { designId: record.designId, revisionId: record.revisionId, sequence: record.sequence };
}

export function recordedArrange(
  manifest: CanvasManifest,
  mutationId: string,
  fingerprint: string,
  builds: BuildStates,
): CanvasChange | null {
  const record = findMutation(manifest, mutationId, 'arrange', fingerprint);
  if (record?.kind !== 'arrange') return null;
  return {
    canvasId: manifest.canvasId,
    sequence: record.sequence,
    // The layout comes from the record, the rest of each frame from the current
    // head, so a frame later commits removed is simply no longer in the answer.
    frames: record.placements.flatMap((placement) => {
      const design = manifest.designs.find((entry) => entry.designId === placement.designId);
      return design ? [toFrame(manifest.canvasId, { ...design, ...placement }, builds)] : [];
    }),
    removedDesignIds: [],
  };
}

export function recordedRemove(
  manifest: CanvasManifest,
  mutationId: string,
  fingerprint: string,
): { undoId: string } | null {
  const record = findMutation(manifest, mutationId, 'remove', fingerprint);
  return record?.kind === 'remove' ? { undoId: record.undoId } : null;
}

export function recordedUndo(
  manifest: CanvasManifest,
  mutationId: string,
  fingerprint: string,
  builds: BuildStates,
): CanvasChange | null {
  const record = findMutation(manifest, mutationId, 'undo', fingerprint);
  if (record?.kind !== 'undo') return null;
  return {
    canvasId: manifest.canvasId,
    sequence: record.sequence,
    frames: record.designs.map((design) => toFrame(manifest.canvasId, design, builds)),
    removedDesignIds: [],
  };
}

export function recordedRename(
  manifest: CanvasManifest,
  mutationId: string,
  fingerprint: string,
  builds: BuildStates,
): CanvasChange | null {
  const record = findMutation(manifest, mutationId, 'rename', fingerprint);
  if (record?.kind !== 'rename') return null;
  return {
    canvasId: manifest.canvasId,
    sequence: record.sequence,
    frames: [toFrame(manifest.canvasId, record.design, builds)],
    removedDesignIds: [],
  };
}

/** Which annotations an accepted annotate changed, read as they are on the head now. */
export function recordedAnnotate(
  manifest: CanvasManifest,
  mutationId: string,
  fingerprint: string,
): CanvasChange | null {
  const record = findMutation(manifest, mutationId, 'annotate', fingerprint);
  if (record?.kind !== 'annotate') return null;
  return {
    canvasId: manifest.canvasId,
    sequence: record.sequence,
    frames: [],
    removedDesignIds: [],
    annotations: {
      version: record.annotationsVersion,
      // Like an arrange's frames: one a later commit removed is no longer in the answer.
      upserted: manifest.annotations.filter((entry) => record.upsertedIds.includes(entry.id)),
      removedIds: [...record.removedIds],
    },
  };
}
