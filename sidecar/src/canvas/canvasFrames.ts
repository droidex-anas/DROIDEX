// Turning one `canvas_create` into the designs a commit appends: an identity
// and any seeded source per frame, prepared before the commit owner runs, and
// the placement, which can only be decided against the manifest being extended.

import { randomUUID } from 'node:crypto';
import { canvasError } from './canvasError.js';
import { REVISION_METADATA_VERSION, type CanvasFiles } from './canvasFiles.js';
import type { PersistedDesign } from './canvasManifest.js';
import type { CreateFramesInput } from './protocol.js';

/** Gap between a created frame and its neighbour, for deterministic placement. */
const FRAME_GAP_PX = 80;

/** One frame's identity and seeded source, before its position is known. */
export interface StagedFrame {
  designId: string;
  revisionId: string | null;
  frame: CreateFramesInput['frames'][number];
}

export async function stageFrames(
  files: CanvasFiles,
  canvasId: string,
  input: CreateFramesInput,
): Promise<StagedFrame[]> {
  const staged: StagedFrame[] = [];
  for (const frame of input.frames) {
    const designId = randomUUID();
    const revisionId = await stageSeed(files, canvasId, designId, frame);
    staged.push({ designId, revisionId, frame });
  }
  return staged;
}

/** New frames land in a row to the right of everything already placed. */
export function placeFrames(
  staged: readonly StagedFrame[],
  placed: readonly PersistedDesign[],
): PersistedDesign[] {
  let x = 0;
  let y = 0;
  if (placed.length > 0) {
    let right = Number.NEGATIVE_INFINITY;
    let top = Number.POSITIVE_INFINITY;
    for (const design of placed) {
      right = Math.max(right, design.rect.x + design.rect.width);
      top = Math.min(top, design.rect.y);
    }
    x = right + FRAME_GAP_PX;
    y = top;
  }
  const designs: PersistedDesign[] = [];
  for (const { designId, revisionId, frame } of staged) {
    designs.push({
      designId,
      name: frame.name,
      rect: { x, y, width: frame.width, height: frame.height },
      layoutVersion: 0,
      revisionId,
      designSystem: frame.designSystem,
    });
    x += frame.width + FRAME_GAP_PX;
  }
  return designs;
}

/** A seeded frame owns an independent copy of the seed's source tree. */
async function stageSeed(
  files: CanvasFiles,
  canvasId: string,
  designId: string,
  frame: CreateFramesInput['frames'][number],
): Promise<string | null> {
  const seed = frame.seed;
  if (!seed) return null;
  if (seed.kind === 'library')
    throw canvasError('invalid_input', 'Seeding from the library is not available yet.');
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
      parentRevisionId: seed.revision.revisionId,
      designSystem: frame.designSystem,
      createdAt: Date.now(),
    },
    source,
  );
  return revisionId;
}
