import { useRef, useState } from 'react';
import { discardImage, isDesktop, saveImage } from '../lib/desktop';
import { blobToDataUrl, cropImage, processImage } from '../lib/imageFiles';
import type { CropRect, ImagePasteQuality } from '../lib/images';
import { toast } from '../lib/toast';
import { createCropMutations, saveImageUnlessStale } from './attachmentStaging';
import { useStagedAttachments } from './useStagedAttachments';

export interface AttachedImage {
  id: string;
  /** Absolute path in the temp attachments dir; this is what the prompt @-mentions. */
  path: string;
  /** Data URL of the saved (fidelity-processed) image, used for chips/viewer. */
  preview: string;
  /** Composer-intake order, shared with pasted files so mixed drops stay in order. */
  sequence: number;
}

export function useImageAttachments(quality: ImagePasteQuality) {
  const staged = useStagedAttachments<AttachedImage>(discardImage);
  const {
    items: images,
    itemsRef: imagesRef,
    additions,
    commit,
    remove,
    clear,
    clearAndDiscard,
    clearReady,
  } = staged;
  const cropOwnersRef = useRef(new Map<string, symbol>());
  const [crops] = useState(createCropMutations);

  const addBlob = (blob: Blob, sequence?: number) => {
    if (!isDesktop()) {
      toast.error('Image attachments need the desktop app');
      return;
    }
    // Reserve the chip's position synchronously: a paste whose encode runs
    // long must not overtake one that was added later but finished earlier.
    const seq = staged.reserveSequence(sequence);
    const stamp = additions.stamp();
    const task = (async () => {
      try {
        const raw = await blobToDataUrl(blob);
        const processed = await processImage(raw, quality);
        const path = await saveImageUnlessStale(
          additions,
          stamp,
          () => saveImage(processed),
          discardImage,
        );
        // clear() ran during the encode (submit): the fresh file was deleted
        // rather than reviving a chip on the next prompt.
        if (path === null) return;
        const image = { id: crypto.randomUUID(), path, preview: processed, sequence: seq };
        staged.insert(image, seq);
      } catch {
        toast.error('Could not attach that image');
      }
    })();
    additions.track(task);
  };

  // Errors propagate so the viewer can keep the crop UI open and report them.
  const applyCrop = async (id: string, rect: CropRect) => {
    const target = imagesRef.current.find((i) => i.id === id);
    if (!target) return;
    const owner = Symbol();
    cropOwnersRef.current.set(id, owner);
    // Tracked as a mutation of an existing chip, not a new add: whenReady
    // waits for crops that start while an earlier encode is still in flight.
    const stamp = additions.stamp();
    const task = (async () => {
      const cropped = await cropImage(target.preview, rect, quality);
      // A clear() (submit) during the crop means the old path is now
      // referenced by a prompt; the new file is discarded, state left alone.
      const path = await saveImageUnlessStale(
        additions,
        stamp,
        () => saveImage(cropped),
        discardImage,
      );
      if (path === null) return;
      // Removed chips and superseded crops discard only their own saved file.
      const existing = imagesRef.current.find((i) => i.id === id);
      if (!existing || cropOwnersRef.current.get(id) !== owner) {
        void discardImage(path);
        return;
      }
      commit(imagesRef.current.map((i) => (i.id === id ? { ...i, path, preview: cropped } : i)));
      // After the commit: exactly one deletion of the superseded file.
      void discardImage(existing.path);
    })();
    crops.track(target.sequence, task);
    try {
      await task;
    } finally {
      if (cropOwnersRef.current.get(id) === owner) cropOwnersRef.current.delete(id);
    }
  };

  const whenReady = (cutoff: number) => staged.whenReady(cutoff, crops.waitBeforeCutoff);

  return { images, addBlob, remove, applyCrop, clear, clearAndDiscard, whenReady, clearReady };
}
