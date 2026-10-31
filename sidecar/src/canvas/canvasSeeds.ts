import { randomUUID } from 'node:crypto';
import { saveOwnedAsset, type OwnedImage } from './canvasAssets.js';
import { canvasError } from './canvasError.js';
import type { CanvasFiles } from './canvasFiles.js';
import { readLibraryCopy } from './canvasLibrary.js';
import { REVISION_METADATA_VERSION } from './canvasRevisionMetadata.js';
import type { CreateFramesInput } from './protocol.js';

/** A seeded frame owns a complete independent copy; IDs record provenance only. */
export async function stageSeed(
  files: CanvasFiles,
  root: string,
  canvasId: string,
  designId: string,
  frame: CreateFramesInput['frames'][number],
): Promise<string | null> {
  const seed = frame.seed;
  if (!seed) return null;
  let source: ReadonlyMap<string, string>;
  let images: OwnedImage[] = [];
  if (seed.kind === 'library') {
    ({ files: source, images } = await readLibraryCopy(seed.itemId));
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
  return revisionId;
}
