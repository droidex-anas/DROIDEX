// Kit images enter the kit store only through main's picker or a drop onto the
// Assets section (spec §8), never from an agent. Main validates the bytes and
// rejects with a curated { code, message } that never names the file's path.

import { useEffect, useLayoutEffect, useState, type DragEvent } from 'react';
import { importKitImage, pickKitImage } from '../../../lib/desktop';
import { pushToast } from '../../../lib/toast';
import type { DesignSystemDocumentView, OwnedAsset } from '../protocol';
import {
  currentDraft,
  draftOf,
  freshAsset,
  FULL_KIT_MESSAGE,
  MAX_ASSET_NAME_LENGTH,
  type DraftChange,
} from './documentDraft';

const IMAGE_TYPES: ReadonlySet<string> = new Set(['image/png', 'image/jpeg', 'image/webp']);

/** An image now in the kit store, with the name its entry starts with. */
export interface ImportedImage {
  asset: OwnedAsset;
  name: string;
}

/** One pick or drop: the images main imported and the files it did not. */
interface ImageBatch {
  images: ImportedImage[];
  unsupported: number;
  failures: unknown[];
}

/**
 * A view's image requests. Each result goes to the view's callback as it is
 * when the request settles, so a view that has left or turned read-only takes
 * none. `replace` supersedes every request still in flight: the newest wins.
 */
export class ImageRequests<T> {
  private deliver: ((result: T) => void) | null = null;
  private generation = 0;

  /** Where results go now; null once the view cannot change the kit. */
  setTarget(deliver: ((result: T) => void) | null): void {
    this.deliver = deliver;
  }

  add(request: Promise<T | null>): Promise<void> {
    return this.settle(request, this.generation);
  }

  replace(request: Promise<T | null>): Promise<void> {
    this.generation += 1;
    return this.settle(request, this.generation);
  }

  private async settle(request: Promise<T | null>, generation: number): Promise<void> {
    const result = await request;
    if (result !== null && generation === this.generation) this.deliver?.(result);
  }
}

/** Image requests delivered to `deliver` as the latest render passes it, and to nothing after unmount. */
export function useImageRequests<T>(deliver: ((result: T) => void) | null): ImageRequests<T> {
  const [requests] = useState(() => new ImageRequests<T>());
  useLayoutEffect(() => {
    requests.setTarget(deliver);
  });
  useEffect(
    () => () => {
      requests.setTarget(null);
    },
    [requests],
  );
  return requests;
}

/**
 * Imports images from main's picker or from files dropped on the section, and
 * reports everything a batch could not add, the kit's image limit included, in
 * one toast as it lands. `onImported` adds the images and returns how many did
 * not fit; it is null where the kit cannot change, which turns both off: `pick`
 * is null and drops pass through.
 */
export function useKitImageImport(onImported: ((images: ImportedImage[]) => number) | null) {
  const [pending, setPending] = useState(0);
  const [isOver, setOver] = useState(false);
  const requests = useImageRequests(
    onImported &&
      ((batch: ImageBatch) => {
        const overCap = batch.images.length > 0 ? onImported(batch.images) : 0;
        const refusal = refusalMessage(batch, overCap);
        if (refusal) pushToast(refusal, 'error');
      }),
  );

  const run = (task: Promise<ImageBatch>) => {
    if (!onImported) return;
    setPending((count) => count + 1);
    void requests.add(task).finally(() => {
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
        run(
          pickImage().then((asset) => ({
            images: asset ? [{ asset, name: 'Image' }] : [],
            unsupported: 0,
            failures: [],
          })),
        );
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

/**
 * Adds imported images to a section as asset entries, stopping at the kit's
 * image limit, and returns how many did not fit.
 */
export function addImages(
  view: DesignSystemDocumentView,
  sectionId: string,
  images: ImportedImage[],
  change: (next: DraftChange) => void,
): number {
  for (const [added, { asset, name }] of images.entries()) {
    const item = freshAsset(currentDraft(view.id) ?? draftOf(view), asset.assetId, name);
    if (!item) return images.length - added;
    change({ kind: 'addItem', sectionId, item });
  }
  return 0;
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

async function importDropped(files: File[]): Promise<ImageBatch> {
  const supported = files.filter((file) => IMAGE_TYPES.has(file.type));
  const settled = await Promise.allSettled(
    supported.map(async (file) => ({
      asset: await importKitImage(file),
      name: fileStem(file.name),
    })),
  );
  return {
    images: settled.flatMap((result) => (result.status === 'fulfilled' ? [result.value] : [])),
    unsupported: files.length - supported.length,
    failures: settled.flatMap((result) =>
      result.status === 'rejected' ? [result.reason as unknown] : [],
    ),
  };
}

function refusalMessage({ unsupported, failures }: ImageBatch, overCap: number): string | null {
  const reasons = [
    unsupported > 0 ? 'Only PNG, JPEG and WebP images can be added.' : null,
    failures.length > 0 ? importFailure(failures[0]) : null,
    overCap > 0 ? FULL_KIT_MESSAGE : null,
  ].filter((reason) => reason !== null);
  const skipped = unsupported + failures.length + overCap;
  if (skipped === 0) return null;
  if (skipped === 1) return reasons[0];
  return `${String(skipped)} files were not added. ${reasons.join(' ')}`;
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
