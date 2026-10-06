// What a create or a write puts on disk before the commit owner runs: an
// identity and any seeded source per new frame, a complete immutable revision
// for a changed one, and the placement, which can only be decided against the
// manifest being extended.

import { randomUUID } from 'node:crypto';
import { canvasError, CanvasCommandError } from './canvasError.js';
import { REVISION_METADATA_VERSION, type CanvasFiles, type NewRevision } from './canvasFiles.js';
import type { PersistedDesign } from './canvasManifest.js';
import type { CreateFramesInput, WriteFilesInput } from './protocol.js';
import { mergedRevisionViolation } from './schema.js';

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

/**
 * Writes the complete revision one accepted change produces: the design's
 * current source with this change applied, flushed into an immutable tree. The
 * caller publishes it by moving the manifest pointer; until then it is an
 * unreferenced revision, which is harmless.
 */
export async function stageRevision(
  files: CanvasFiles,
  canvasId: string,
  design: PersistedDesign,
  input: WriteFilesInput,
): Promise<NewRevision> {
  const merged = mergeSource(await currentSource(files, canvasId, design), input);
  const violation = mergedRevisionViolation(merged);
  if (violation) throw canvasError('invalid_input', violation);
  const revision: NewRevision = {
    version: REVISION_METADATA_VERSION,
    designId: input.designId,
    revisionId: randomUUID(),
    parentRevisionId: design.revisionId,
    designSystem: input.designSystem ?? design.designSystem,
    createdAt: Date.now(),
  };
  await files.publishRevision(canvasId, revision, merged);
  return revision;
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
      lastWorkingRevisionId: null,
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

/** The manifest points at this revision, so a missing tree is storage damage. */
async function currentSource(
  files: CanvasFiles,
  canvasId: string,
  design: PersistedDesign,
): Promise<Map<string, string>> {
  const revisionId = design.revisionId;
  if (revisionId === null) return new Map<string, string>();
  try {
    return await files.readRevision(canvasId, { designId: design.designId, revisionId });
  } catch (error) {
    if (error instanceof CanvasCommandError && error.code === 'invalid_input')
      throw canvasError('storage_failed', 'The saved source for that frame is missing.');
    throw error;
  }
}

function mergeSource(current: Map<string, string>, input: WriteFilesInput): Map<string, string> {
  for (const path of input.deletedPaths) current.delete(path);
  for (const [path, content] of Object.entries(input.files)) current.set(path, content);
  return current;
}
