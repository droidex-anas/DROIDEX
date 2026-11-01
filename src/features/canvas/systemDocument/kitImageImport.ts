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
 * reports each batch's refusals in one toast. `onImported` is null where the
 * kit cannot change, which turns both off: `pick` is null and drops pass through.
 */
export function useKitImageImport(onImported: ((images: ImportedImage[]) => void) | null) {
  const [pending, setPending] = useState(0);
  const [isOver, setOver] = useState(false);
  const requests = useImageRequests(onImported);

  const run = (task: Promise<ImportedImage[]>) => {
    if (!onImported) return;
    setPending((count) => count + 1);
    void requests.add(task.then((images) => (images.length > 0 ? images : null))).finally(() => {
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

/** Adds imported images to a section as asset entries, stopping at the kit's image limit. */
export function addImages(
  view: DesignSystemDocumentView,
  sectionId: string,
  images: ImportedImage[],
  change: (next: DraftChange) => void,
) {
  for (const { asset, name } of images) {
    const item = freshAsset(currentDraft(view.id) ?? draftOf(view), asset.assetId, name);
    if (!item) {
      pushToast(FULL_KIT_MESSAGE, 'error');
      return;
    }
    change({ kind: 'addItem', sectionId, item });
  }
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
  const settled = await Promise.allSettled(
    images.map(async (file) => ({ asset: await importKitImage(file), name: fileStem(file.name) })),
  );
  const failures = settled.flatMap((result) =>
    result.status === 'rejected' ? [result.reason as unknown] : [],
  );
  const refusal = refusalMessage(files.length - images.length, failures);
  if (refusal) pushToast(refusal, 'error');
  return settled.flatMap((result) => (result.status === 'fulfilled' ? [result.value] : []));
}

function refusalMessage(unsupported: number, failures: unknown[]): string | null {
  const skipped = unsupported + failures.length;
  if (skipped === 0) return null;
  if (unsupported === 0 && failures.length === 1) return importFailure(failures[0]);
  const files = skipped === 1 ? '1 file' : `${String(skipped)} files`;
  if (failures.length === 0) return `${files} skipped: not PNG, JPEG or WebP.`;
  const reasons = [
    unsupported > 0 ? 'Only PNG, JPEG and WebP images can be added.' : null,
    importFailure(failures[0]),
  ];
  return `${files} skipped. ${reasons.filter((reason) => reason !== null).join(' ')}`;
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
