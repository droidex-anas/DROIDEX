// What a create or a write puts on disk before the commit owner runs: an
// identity and any seeded source per new frame, a complete immutable revision
// for a changed one, and the placement, which can only be decided against the
// manifest being extended.

import { randomUUID } from 'node:crypto';
import { canvasError, CanvasCommandError } from './canvasError.js';
import type { CanvasFiles } from './canvasFiles.js';
import type { CanvasManifest, PersistedDesign, SourceRevisionMutation } from './canvasManifest.js';
import { REVISION_METADATA_VERSION, type NewRevision } from './canvasRevisionMetadata.js';
import { stageSeed } from './canvasSeeds.js';
import { designEntryDiagnostic } from './designEntry.js';
import { FRAME_GAP_PX, placeVariants } from './canvasVariantPlacement.js';
import type { CreateFramesInput, SvgImageReason, WriteFilesInput } from './protocol.js';
import { mergedRevisionViolation, type FrameRect } from './schema.js';

export interface SourceWriteOptions {
  mutation?: SourceRevisionMutation;
  validateSource?: (files: ReadonlyMap<string, string>) => void | Promise<void>;
}

/** One frame's identity and seeded source, before its position is known. */
export interface StagedFrame {
  designId: string;
  revisionId: string | null;
  svgAsImage?: SvgImageReason;
  frame: CreateFramesInput['frames'][number];
}

export async function stageFrames(
  files: CanvasFiles,
  root: string,
  canvasId: string,
  input: CreateFramesInput,
): Promise<StagedFrame[]> {
  const staged: StagedFrame[] = [];
  for (const frame of input.frames) {
    const designId = randomUUID();
    const seeded = await stageSeed(files, root, canvasId, designId, frame);
    staged.push({ designId, revisionId: null, ...seeded, frame });
  }
  return staged;
}

const SOURCE_REMOVED = 'That source frame was removed. Undo it before creating a variant.';
const SOURCE_UNKNOWN = 'No frame on this board has that id.';

/** A seed can copy only a frame that still belongs to this board. */
export function requireSeedFrames(manifest: CanvasManifest, input: CreateFramesInput): void {
  for (const frame of input.frames) {
    const seed = frame.seed;
    if (seed?.kind === 'revision' && seed.canvasId === manifest.canvasId)
      requireOnBoard(manifest, seed.revision.designId);
  }
}

/** Points to Undo only while Undo can still bring the frame back. */
function requireOnBoard(manifest: CanvasManifest, designId: string): void {
  if (manifest.designs.some((design) => design.designId === designId)) return;
  const undoable = manifest.tombstones.some(
    (tombstone) =>
      !tombstone.consumed && tombstone.designs.some((design) => design.designId === designId),
  );
  throw canvasError('not_found', undoable ? SOURCE_REMOVED : SOURCE_UNKNOWN);
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
  { validateSource }: SourceWriteOptions,
): Promise<NewRevision> {
  const merged = mergeSource(await currentSource(files, canvasId, design), input);
  const violation = mergedRevisionViolation(merged);
  if (violation) throw canvasError('invalid_input', violation);
  const entry = designEntryDiagnostic([...merged.keys()]);
  if (entry) throw canvasError('invalid_source', entry.message);
  if (validateSource) await validateSource(merged);
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
  manifest: CanvasManifest,
  placeBeside: CreateFramesInput['placeBeside'],
): PersistedDesign[] {
  const placed = manifest.designs;
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
    if (frame.variantOf && placeBeside && frame.variantOf !== placeBeside.designId)
      throw canvasError('invalid_input', 'Place a variant beside the frame it is a variant of.');
    if (frame.variantOf) requireOnBoard(manifest, frame.variantOf);
    const position = positions ? positions[designs.length] : { x, y };
    designs.push({
      designId,
      name: frame.name,
      rect: { x: position.x, y: position.y, width: frame.width, height: frame.height },
      layoutVersion: 0,
      manifestVersion: 0,
      revisionId,
      lastWorkingRevisionId: null,
      designSystem: frame.designSystem,
      ...(frame.seed ? { seed: structuredClone(frame.seed) } : {}),
      ...(frame.seed && revisionId ? { seededRevisionId: revisionId } : {}),
      ...(frame.variantOf ? { variantOf: frame.variantOf } : {}),
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
