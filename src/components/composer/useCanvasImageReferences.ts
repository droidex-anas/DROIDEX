// Reference images for a request on a canvas (spec §10). An image dropped from
// disk is imported into the canvas as an owned asset, which the agent places by
// its ID; the downscaled copy the composer already makes still goes as an
// ordinary attachment, which is how the model sees its pixels. Each reference
// is keyed by the attachment's intake sequence, so one chip removes both.

import { useCallback, useRef, useState } from 'react';
import { NEW_CANVAS_KEY } from '../../features/canvas/designSystemChoices';
import { useStoreSelector } from '../../hooks/useStore';
import { importCanvasImage, pathForFile } from '../../lib/desktop';
import { composerCanvasKey } from './useComposerReferences';

/** The sidecar's CANVAS_LIMITS.maxPinnedImages. */
const MAX_IMAGES = 8;
const UNSAVED = 'The image could not be saved. Reopen DROIDEX and try again.';

export type CanvasImageReference =
  | { status: 'importing'; name: string }
  | { status: 'imported'; name: string; assetId: string }
  | { status: 'failed'; name: string; message: string };

interface References {
  canvasId: string | null;
  bySequence: ReadonlyMap<number, CanvasImageReference>;
}

const NONE: References = { canvasId: null, bySequence: new Map() };

function failureMessage(error: unknown): string {
  if (typeof error === 'object' && error !== null && 'message' in error)
    if (typeof error.message === 'string') return error.message;
  return UNSAVED;
}

export function useCanvasImageReferences(appSessionId: string | null) {
  // A Design home prompt makes its canvas only once it is sent, so its images
  // stay plain attachments.
  const canvasId = useStoreSelector((state) => {
    const key = composerCanvasKey(state, appSessionId);
    return key === NEW_CANVAS_KEY ? null : key;
  });
  const [references, setReferences] = useState(NONE);
  // Read after awaits, where the render's copy would be stale.
  const referencesRef = useRef(references);
  const imports = useRef(new Map<number, Promise<unknown>>());
  // References belong to one canvas; a chat that moves on sees none of them.
  const current = references.canvasId === canvasId ? references.bySequence : NONE.bySequence;

  const commit = useCallback((next: References) => {
    referencesRef.current = next;
    setReferences(next);
  }, []);

  const put = (target: string, sequence: number, reference: CanvasImageReference) => {
    const held = referencesRef.current;
    const bySequence = new Map(held.canvasId === target ? held.bySequence : []);
    commit({ canvasId: target, bySequence: bySequence.set(sequence, reference) });
  };

  // A reference removed or cleared while importing stays gone.
  const land = (target: string, sequence: number, reference: CanvasImageReference) => {
    const held = referencesRef.current;
    if (held.canvasId === target && held.bySequence.has(sequence)) put(target, sequence, reference);
  };

  const importFile = (file: File, sequence: number) => {
    // A pasted bitmap has no file on disk for the canvas to own.
    if (canvasId === null || !pathForFile(file)) return;
    const target = canvasId;
    const active = [...current.values()].filter((reference) => reference.status !== 'failed');
    if (active.length >= MAX_IMAGES) {
      put(target, sequence, {
        status: 'failed',
        name: file.name,
        message: `One request takes at most ${String(MAX_IMAGES)} reference images.`,
      });
      return;
    }
    put(target, sequence, { status: 'importing', name: file.name });
    const task = importCanvasImage(target, file).then(
      (asset) => {
        land(target, sequence, { status: 'imported', name: file.name, assetId: asset.assetId });
      },
      (error: unknown) => {
        land(target, sequence, {
          status: 'failed',
          name: file.name,
          message: failureMessage(error),
        });
      },
    );
    imports.current.set(sequence, task);
    void task.finally(() => {
      if (imports.current.get(sequence) === task) imports.current.delete(sequence);
    });
  };

  const remove = (sequences: readonly number[]) => {
    const held = referencesRef.current;
    if (!sequences.some((sequence) => held.bySequence.has(sequence))) return;
    const bySequence = new Map(held.bySequence);
    for (const sequence of sequences) bySequence.delete(sequence);
    commit({ ...held, bySequence });
  };

  // Stable: the composer's chat-switch effect lists it.
  const clear = useCallback(() => {
    commit(NONE);
  }, [commit]);

  return {
    referenceOf: (sequence: number): CanvasImageReference | undefined => current.get(sequence),
    importFile,
    remove,
    clear,
    /** The asset IDs of the images a send carries, once their imports have settled. */
    assetIdsFor: async (sequences: readonly number[]): Promise<string[]> => {
      await Promise.allSettled(
        sequences.flatMap((sequence) => imports.current.get(sequence) ?? []),
      );
      const held = referencesRef.current;
      if (held.canvasId !== canvasId) return [];
      return sequences.flatMap((sequence) => {
        const reference = held.bySequence.get(sequence);
        return reference?.status === 'imported' ? [reference.assetId] : [];
      });
    },
  };
}
