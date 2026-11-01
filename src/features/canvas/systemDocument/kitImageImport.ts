// Kit images enter the kit store only through main's picker or a drop onto the
// Assets section (spec §8), never from an agent. Main validates the bytes and
// rejects with a curated { code, message } that never names the file's path.

import { useState, type DragEvent } from 'react';
import { importKitImage, pickKitImage } from '../../../lib/desktop';
import { pushToast } from '../../../lib/toast';
import type { OwnedAsset } from '../protocol';

export const MAX_ASSET_NAME_LENGTH = 120;
const IMAGE_TYPES: ReadonlySet<string> = new Set(['image/png', 'image/jpeg', 'image/webp']);

/** An image now in the kit store, with the name its entry starts with. */
export interface ImportedImage {
  asset: OwnedAsset;
  name: string;
}

/**
 * Imports images from main's picker or from files dropped on the section, and
 * reports each failure once. `onImported` is null where the kit cannot change,
 * which turns both off: `pick` is null and drops pass through.
 */
export function useKitImageImport(onImported: ((images: ImportedImage[]) => void) | null) {
  const [pending, setPending] = useState(0);
  const [isOver, setOver] = useState(false);

  const run = (task: Promise<ImportedImage[]>) => {
    if (!onImported) return;
    setPending((count) => count + 1);
    void task
      .then((images) => {
        if (images.length > 0) onImported(images);
      })
      .finally(() => {
        setPending((count) => count - 1);
      });
  };

  const isFileDrag = (event: DragEvent) =>
    onImported !== null && event.dataTransfer.types.includes('Files');

  return {
    isImporting: pending > 0,
    isOver,
    pick:
      onImported &&
      (() => {
        run(pickImage().then((asset) => (asset ? [{ asset, name: 'Image' }] : [])));
      }),
    dropHandlers: {
      onDragOver: (event: DragEvent) => {
        if (!isFileDrag(event)) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = 'copy';
        setOver(true);
      },
      onDragLeave: (event: DragEvent) => {
        const next = event.relatedTarget;
        if (next instanceof Node && event.currentTarget.contains(next)) return;
        setOver(false);
      },
      onDrop: (event: DragEvent) => {
        setOver(false);
        if (!isFileDrag(event)) return;
        event.preventDefault();
        run(importDropped(Array.from(event.dataTransfer.files)));
      },
    },
  };
}

/** Main's image picker into the kit store; a failure is reported and reads as no image. */
export async function pickImage(): Promise<OwnedAsset | null> {
  try {
    return await pickKitImage();
  } catch (error) {
    pushToast(importFailure(error), 'error');
    return null;
  }
}

async function importDropped(files: File[]): Promise<ImportedImage[]> {
  const images = files.filter((file) => IMAGE_TYPES.has(file.type));
  if (images.length < files.length)
    pushToast('Only PNG, JPEG and WebP images can be added to a design system.', 'error');
  const settled = await Promise.allSettled(
    images.map(async (file) => ({ asset: await importKitImage(file), name: fileStem(file.name) })),
  );
  const failure = settled.find((result) => result.status === 'rejected');
  if (failure) pushToast(importFailure(failure.reason), 'error');
  return settled.flatMap((result) => (result.status === 'fulfilled' ? [result.value] : []));
}

function fileStem(fileName: string): string {
  const stem = fileName.replace(/\.[^.]+$/, '').trim();
  return stem.slice(0, MAX_ASSET_NAME_LENGTH) || 'Image';
}

function importFailure(error: unknown): string {
  if (typeof error === 'object' && error !== null && 'message' in error)
    if (typeof error.message === 'string' && error.message !== '') return error.message;
  return 'The image could not be added. Try again.';
}
