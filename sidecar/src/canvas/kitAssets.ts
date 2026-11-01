// Kit images (design system documents spec §8): PNG, JPEG and WebP the user
// chose through main's picker or drop, kept once by content hash in
// `canvases/design-systems/assets` with the same record as a canvas image. A
// document names one by asset ID; its name and note live in the document, so
// one image can serve several kits under different names. Only main imports
// bytes; an agent can only refer to an image that is already here.

import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import {
  canvasImageImportSchema,
  readChosenImage,
  readImageIn,
  saveImageIn,
  type ChosenImage,
} from './canvasAssets.js';
import { canvasError, CanvasCommandError, storageFailure } from './canvasError.js';
import type { ExportFile } from './canvasExport.js';
import type { DesignSystem } from './designSystems.js';
import { exists, flushAncestors, refuseLinkedPath, systemsRoot } from './designSystemStorage.js';
import type { OwnedAsset } from './protocol.js';

const KIT_ASSET_REFERENCE = /kit-asset:([0-9a-f]{64})\b/g;
const MISSING_KIT_ASSET = 'An image this design system uses is not in DROIDEX. Import it first.';

export const kitImageImportSchema = canvasImageImportSchema.omit({ canvasId: true });

/** Keeps the chosen image in the kit store; importing the same bytes again changes nothing. */
export async function importKitImage(request: ChosenImage): Promise<OwnedAsset> {
  const { asset, bytes } = await readChosenImage(request);
  const store = systemsRoot();
  try {
    await refuseLinkedPath(join(store, 'assets'));
    await mkdir(store, { recursive: true });
    await flushAncestors(store);
  } catch (error) {
    throw storageFailure('The image could not be saved. Free disk space and try again.', error);
  }
  await saveImageIn(store, asset, bytes);
  return asset;
}

/** Refuses a document that names an image nobody imported, the agent's only way to add one. */
export async function refuseUnknownKitAssets(
  document: Pick<DesignSystem, 'cover' | 'sections'>,
): Promise<void> {
  for (const assetId of documentKitAssetIds(document))
    if (!(await exists(join(systemsRoot(), 'assets', `${assetId}.json`))))
      throw canvasError('invalid_input', MISSING_KIT_ASSET);
}

/** The kit images a document shows: its cover and its asset items. */
export function documentKitAssetIds({
  cover,
  sections,
}: Pick<DesignSystem, 'cover' | 'sections'>): Set<string> {
  const assetIds = new Set<string>();
  if (cover?.kind === 'image') assetIds.add(cover.assetId);
  for (const section of sections)
    for (const item of section.items) if (item.kind === 'asset') assetIds.add(item.assetId);
  return assetIds;
}

/** The kit images some text refers to as `kit-asset:`, each once. */
export function referencedKitAssetIds(contents: Iterable<string>): Set<string> {
  const assetIds = new Set<string>();
  for (const content of contents)
    for (const match of content.matchAll(KIT_ASSET_REFERENCE)) assetIds.add(match[1]);
  return assetIds;
}

/** Each kit image, verified against its record and digest, as an export's `assets/<id>`. */
export async function kitImageFiles(
  assetIds: Iterable<string>,
  signal?: AbortSignal,
): Promise<ExportFile[]> {
  const files: ExportFile[] = [];
  for (const assetId of assetIds) {
    signal?.throwIfAborted();
    try {
      const { bytes } = await readImageIn(systemsRoot(), assetId);
      files.push({ path: `assets/${assetId}`, content: bytes });
    } catch (error) {
      if (error instanceof CanvasCommandError && error.code === 'not_found')
        throw canvasError('not_found', MISSING_KIT_ASSET);
      throw error;
    }
  }
  return files;
}

/**
 * Points every `kit-asset:` reference at the preview host, which serves kit
 * images to any bound guest the way it serves kit fonts. Unlike a canvas image
 * the URL needs no signature: no canvas owns a kit image.
 */
export function resolveKitAssetReferences(text: string): string {
  return text.replace(KIT_ASSET_REFERENCE, 'droidex-canvas-preview://preview/kit-asset/$1');
}
