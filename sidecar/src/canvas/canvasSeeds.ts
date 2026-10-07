import { randomUUID } from 'node:crypto';
import { canvasError } from './canvasError.js';
import { REVISION_METADATA_VERSION, type CanvasFiles } from './canvasFiles.js';
import type { CreateFramesInput } from './protocol.js';

/** A seeded frame owns a complete independent copy; IDs record provenance only. */
export async function stageSeed(
  files: CanvasFiles,
  canvasId: string,
  designId: string,
  frame: CreateFramesInput['frames'][number],
): Promise<string | null> {
  const seed = frame.seed;
  if (!seed) return null;
  if (seed.kind === 'library')
    throw canvasError('invalid_input', 'Seeding from the library is not available yet.');
  // Current leases authorize one canvas, including reads used to copy source.
  if (seed.canvasId !== canvasId)
    throw canvasError('invalid_input', 'A seed revision must come from this canvas.');
  const source = await files.readRevision(canvasId, seed.revision);
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
  return revisionId;
}
