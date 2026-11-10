import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { readImageIn, saveOwnedAsset, type OwnedImage } from './canvasAssets.js';
import { canvasError } from './canvasError.js';
import type { CanvasFiles } from './canvasFiles.js';
import { readLibraryCopy } from './canvasLibrary.js';
import { REVISION_METADATA_VERSION } from './canvasRevisionMetadata.js';
import { DESIGN_ENTRY } from './designEntry.js';
import type { CreateFramesInput, SvgImageReason } from './protocol.js';
import { svgFrameSource } from './svgJsx.js';

export interface StagedSeed {
  revisionId: string;
  svgAsImage?: SvgImageReason;
}

/** A seeded frame owns a complete independent copy; IDs record provenance only. */
export async function stageSeed(
  files: CanvasFiles,
  root: string,
  canvasId: string,
  designId: string,
  frame: CreateFramesInput['frames'][number],
): Promise<StagedSeed | null> {
  const seed = frame.seed;
  if (!seed) return null;
  let source: ReadonlyMap<string, string>;
  let images: OwnedImage[] = [];
  let svgAsImage: SvgImageReason | null = null;
  if (seed.kind === 'library') {
    ({ files: source, images } = await readLibraryCopy(seed.itemId));
  } else if (seed.kind === 'svg') {
    // The asset is already this canvas's, so the frame only refers to it.
    const { asset, bytes } = await readImageIn(join(root, canvasId), seed.assetId);
    if (asset.mediaType !== 'image/svg+xml')
      throw canvasError('invalid_input', 'A vector frame is seeded from an SVG image.');
    const drawn = svgFrameSource(asset, bytes, designId);
    source = new Map([[DESIGN_ENTRY, drawn.mainTsx]]);
    svgAsImage = drawn.svgAsImage;
  } else {
    // Current leases authorize one canvas, including reads used to copy source.
    if (seed.canvasId !== canvasId)
      throw canvasError('invalid_input', 'A seed revision must come from this canvas.');
    source = await files.readRevision(canvasId, seed.revision);
  }
  const revisionId = randomUUID();
  await files.publishRevision(
    canvasId,
    {
      version: REVISION_METADATA_VERSION,
      designId,
      revisionId,
      parentRevisionId: null,
      designSystem: frame.designSystem,
      createdAt: Date.now(),
    },
    source,
  );
  // After the revision, whose write creates a new canvas's directory. Like the
  // revision, an image no commit ends up referencing is harmless.
  for (const image of images) await saveOwnedAsset(root, canvasId, image.asset, image.bytes);
  return svgAsImage === null ? { revisionId } : { revisionId, svgAsImage };
}
