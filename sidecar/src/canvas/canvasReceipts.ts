// What a retried mutation answers: the mutation its first run recorded in the
// manifest's ledger. A receipt fixes what the original request decided — a
// created tree, a placement, a written revision — and reads the rest from the
// head as it stands now, so an entry a later commit removed is simply no longer
// part of the answer.

import { findMutation, type CanvasManifest } from './canvasManifest.js';
import { canvasChange, frameChange, toFrame, type BuildStates } from './canvasProjection.js';
import type {
  AnnotatedChange,
  CanvasChange,
  CreateFramesResult,
  WriteReceipt,
} from './protocol.js';

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
  kind: 'write' | 'edit' | 'switch',
  fingerprint: string,
): WriteReceipt | null {
  const record = findMutation(manifest, mutationId, kind, fingerprint);
  if (record?.kind !== 'write' && record?.kind !== 'edit' && record?.kind !== 'switch') return null;
  return { designId: record.designId, revisionId: record.revisionId, sequence: record.sequence };
}

export function recordedArrange(
  manifest: CanvasManifest,
  mutationId: string,
  fingerprint: string,
): CanvasChange | null {
  const record = findMutation(manifest, mutationId, 'arrange', fingerprint);
  if (record?.kind !== 'arrange') return null;
  // The layout comes from the record, the rest of each frame from the current
  // head, so a frame later commits removed is simply no longer in the answer.
  const placed = record.placements.flatMap((placement) => {
    const design = manifest.designs.find((entry) => entry.designId === placement.designId);
    return design ? [{ ...design, ...placement }] : [];
  });
  return { ...frameChange(manifest, placed), sequence: record.sequence };
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
  return { ...canvasChange(manifest, record.designs, builds), sequence: record.sequence };
}

export function recordedFrameEdit(
  manifest: CanvasManifest,
  mutationId: string,
  kind: 'rename' | 'hide',
  fingerprint: string,
): CanvasChange | null {
  const record = findMutation(manifest, mutationId, kind, fingerprint);
  if (record?.kind !== 'rename' && record?.kind !== 'hide') return null;
  return { ...frameChange(manifest, [record.design]), sequence: record.sequence };
}

export function recordedReorder(
  manifest: CanvasManifest,
  mutationId: string,
  fingerprint: string,
): CanvasChange | null {
  const record = findMutation(manifest, mutationId, 'reorder', fingerprint);
  if (record?.kind !== 'reorder') return null;
  return {
    canvasId: manifest.canvasId,
    sequence: record.sequence,
    frames: [],
    builds: [],
    removedDesignIds: [],
    // Like an arrange's frames: one a later commit removed is no longer in the answer.
    order: record.designIds.filter((id) =>
      manifest.designs.some((design) => design.designId === id),
    ),
  };
}

/** Which annotations an accepted annotate changed, read as they are on the head now. */
export function recordedAnnotate(
  manifest: CanvasManifest,
  mutationId: string,
  fingerprint: string,
): AnnotatedChange | null {
  const record = findMutation(manifest, mutationId, 'annotate', fingerprint);
  if (record?.kind !== 'annotate') return null;
  return {
    canvasId: manifest.canvasId,
    sequence: record.sequence,
    frames: [],
    builds: [],
    removedDesignIds: [],
    annotations: {
      version: record.annotationsVersion,
      // Like an arrange's frames: one a later commit removed is no longer in the answer.
      upserted: manifest.annotations.filter((entry) => record.upsertedIds.includes(entry.id)),
      removedIds: [...record.removedIds],
    },
  };
}
