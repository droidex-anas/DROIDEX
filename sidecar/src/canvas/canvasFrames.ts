// What a create or a write puts on disk before the commit owner runs: an
// identity and any seeded source per new frame, a complete immutable revision
// for a changed one, and the placement, which can only be decided against the
// manifest being extended.

import { randomUUID } from 'node:crypto';
import { canvasError, CanvasCommandError } from './canvasError.js';
import { REVISION_METADATA_VERSION, type CanvasFiles, type NewRevision } from './canvasFiles.js';
import type { PersistedDesign } from './canvasManifest.js';
import { stageSeed } from './canvasSeeds.js';
import { FRAME_GAP_PX, placeVariants } from './canvasVariantPlacement.js';
import type { CreateFramesInput, WriteFilesInput } from './protocol.js';
import { mergedRevisionViolation, type FrameRect } from './schema.js';

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

/** Placement is decided against the current board inside the commit queue. */
export function placeFrames(
  staged: readonly StagedFrame[],
  placed: readonly PersistedDesign[],
  placeBeside: CreateFramesInput['placeBeside'],
): PersistedDesign[] {
  let positions: FrameRect[] | undefined;
  if (placeBeside) {
    const source = placed.find((design) => design.designId === placeBeside.designId);
    if (!source) throw canvasError('invalid_input', 'The source frame is not on this canvas.');
    // A batch may contain different dimensions; reserve slots large enough for all.
    const size = {
      width: Math.max(...staged.map(({ frame }) => frame.width)),
      height: Math.max(...staged.map(({ frame }) => frame.height)),
    };
    positions = placeVariants(
      source.rect,
      placed.map((design) => design.rect),
      staged.length,
      size,
    );
  }
  let x = 0;
  let y = 0;
  if (!positions && placed.length > 0) {
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
    const position = positions ? positions[designs.length] : { x, y };
    designs.push({
      designId,
      name: frame.name,
      rect: { x: position.x, y: position.y, width: frame.width, height: frame.height },
      layoutVersion: 0,
      revisionId,
      lastWorkingRevisionId: null,
      designSystem: frame.designSystem,
      ...(frame.seed?.kind === 'revision' ? { seed: structuredClone(frame.seed) } : {}),
    });
    x += frame.width + FRAME_GAP_PX;
  }
  return designs;
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
