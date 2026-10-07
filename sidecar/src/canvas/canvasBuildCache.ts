// The derived build cache of a canvas directory: the artifact document a preview
// loads, the outcome each revision reached, and the build state a restarted
// sidecar can prove from the two. Everything here is rebuildable from canonical
// source (spec §7), so a name that is missing, damaged or no longer parseable is
// a cache miss and never an error. It is also untrusted on the way back in, so
// every entry is revalidated against the current schema.

import { createHash } from 'node:crypto';
import { z } from 'zod';
import type { CanvasFiles } from './canvasFiles.js';
import type { CanvasManifest, PersistedDesign } from './canvasManifest.js';
import type { CanvasBuildOutcome, PreviewArtifact, SourceElement } from './protocol.js';
import { CANVAS_LIMITS, canvasIdentifierSchema, sourceElementSchema } from './schema.js';

const BUILD_OUTCOME_VERSION = 2;

/** How many diagnostics one failed build keeps. The rest add no new advice. */
export const MAX_BUILD_DIAGNOSTICS = 64;

const diagnosticSchema = z
  .object({
    code: z.string().min(1).max(64),
    message: z.string().min(1).max(2048),
    // A design path, or one under `@droidex/design-system/`.
    file: z
      .string()
      .max(CANVAS_LIMITS.maxSourcePathLength + 64)
      .optional(),
    line: z.number().int().nonnegative().optional(),
    column: z.number().int().nonnegative().optional(),
  })
  .strict();

const readyResultSchema = z
  .object({
    status: z.literal('ready'),
    artifactId: canvasIdentifierSchema,
    elements: z.array(sourceElementSchema).max(CANVAS_LIMITS.maxSourceElements),
    diagnostics: z.array(diagnosticSchema).max(MAX_BUILD_DIAGNOSTICS),
  })
  .strict();

const failedResultSchema = z
  .object({
    status: z.literal('failed'),
    diagnostics: z.array(diagnosticSchema).max(MAX_BUILD_DIAGNOSTICS),
  })
  .strict();

const buildOutcomeSchema = z
  .object({
    version: z.literal(BUILD_OUTCOME_VERSION),
    designId: canvasIdentifierSchema,
    revisionId: canvasIdentifierSchema,
    result: z.discriminatedUnion('status', [
      readyResultSchema.extend({ sourceMapDigest: z.string().regex(/^[0-9a-f]{64}$/) }),
      failedResultSchema,
    ]),
  })
  .strict();

/** What one revision's build concluded, as the cache records it. */
export type BuildResult = z.infer<typeof readyResultSchema> | z.infer<typeof failedResultSchema>;

/** The revision a cached outcome belongs to, and what that outcome was. */
interface CachedOutcome {
  designId: string;
  revisionId: string;
  result: BuildResult;
}

/**
 * One design's build outcome as this cache can still prove it. The attempt it
 * belongs to is not cached: nothing has been built in this session, so the
 * registry restores it on attempt zero.
 */
export interface RestoredBuild {
  canvasId: string;
  designId: string;
  outcome: CanvasBuildOutcome;
}

export class CanvasBuildCache {
  constructor(private readonly files: CanvasFiles) {}

  /**
   * One artifact document, named by its own content. It is written before the
   * commit that may publish it, so an attempt that loses its frame can leave an
   * orphan here; nothing reads an artifact that no outcome names.
   */
  saveArtifact(canvasId: string, artifactId: string, html: string): Promise<void> {
    return this.files.writeBuildOutput(canvasId, artifactName(artifactId), html);
  }

  /** What one revision's build concluded, written by the commit that publishes it. */
  async saveOutcome(
    canvasId: string,
    designId: string,
    revisionId: string,
    result: BuildResult,
  ): Promise<void> {
    const stored =
      result.status === 'ready'
        ? {
            ...result,
            sourceMapDigest: sourceMapDigest(
              await this.files.readRevision(canvasId, { designId, revisionId }),
              result.elements,
            ),
          }
        : result;
    const document = { version: BUILD_OUTCOME_VERSION, designId, revisionId, result: stored };
    await this.files.writeBuildOutput(
      canvasId,
      outcomeName(revisionId),
      `${JSON.stringify(document)}\n`,
    );
  }

  /** Takes back an outcome whose build lost its frame while it was writing. */
  discardOutcome(canvasId: string, revisionId: string): Promise<void> {
    return this.files.removeBuildOutput(canvasId, outcomeName(revisionId));
  }

  /**
   * What one revision's build produced, or null when this cache cannot serve it.
   * Reading by revision rather than by artifact ID is what lets a `ready`
   * frame's own revision and a `failed` frame's `lastWorkingRevisionId` be asked
   * for the same way: the second carries no artifact ID at all.
   *
   * A missing, damaged or superseded entry is a miss, never an error, and the
   * manifest still decides which revision is worth asking about (spec §7).
   */
  async readRevisionArtifact(
    canvasId: string,
    designId: string,
    revisionId: string,
  ): Promise<PreviewArtifact | null> {
    const outcome = await this.readOutcome(canvasId, outcomeName(revisionId));
    if (outcome?.designId !== designId || outcome.revisionId !== revisionId) return null;
    if (outcome.result.status !== 'ready') return null;
    const { artifactId } = outcome.result;
    const html = await this.files
      .readBuildOutput(canvasId, artifactName(artifactId))
      .catch(() => null);
    return html === null ? null : { artifactId, html };
  }

  /** Status of this exact revision; an orphan artifact cannot prove a build. */
  async revisionStatus(
    canvasId: string,
    designId: string,
    revisionId: string,
  ): Promise<'ready' | 'failed' | 'building'> {
    const outcome = await this.readOutcome(canvasId, outcomeName(revisionId));
    if (outcome?.designId !== designId || outcome.revisionId !== revisionId) return 'building';
    if (outcome.result.status === 'failed') return 'failed';
    const artifact = await this.files
      .readBuildOutput(canvasId, artifactName(outcome.result.artifactId))
      .catch(() => null);
    return artifact === null ? 'building' : 'ready';
  }

  /**
   * The build state every design on these canvases can be served with. Only the
   * manifest decides that: an outcome it does not vouch for is ignored, which
   * leaves the frame `pending` and due a rebuild. A design is read for its own
   * current revision and no other, so an outcome it has moved past is never
   * consulted at all.
   */
  async restoreStates(manifests: readonly CanvasManifest[]): Promise<RestoredBuild[]> {
    const restored: RestoredBuild[] = [];
    for (const manifest of manifests) {
      // A cache that cannot be read is a cache that gets rebuilt.
      // Canvas storage logs the cause; what matters here is that this canvas's
      // frames stay pending and the sweep rebuilds them.
      const present = await this.files.listBuildOutputs(manifest.canvasId).catch(() => null);
      if (!present) continue;
      for (const design of manifest.designs) {
        const revisionId = design.revisionId;
        if (revisionId === null || !present.has(outcomeName(revisionId))) continue;
        const outcome = await this.readOutcome(manifest.canvasId, outcomeName(revisionId));
        if (outcome?.designId !== design.designId || outcome.revisionId !== revisionId) continue;
        const vouched = vouchedState(design, revisionId, outcome.result, present);
        if (!vouched) continue;
        restored.push({ canvasId: manifest.canvasId, designId: design.designId, outcome: vouched });
      }
    }
    return restored;
  }

  /** A cache entry we cannot read or parse is one we cannot use; it rebuilds. */
  private async readOutcome(canvasId: string, name: string): Promise<CachedOutcome | null> {
    const text = await this.files.readBuildOutput(canvasId, name).catch(() => null);
    if (text === null) return null;
    let value: unknown;
    try {
      value = JSON.parse(text);
    } catch {
      return null;
    }
    const parsed = buildOutcomeSchema.safeParse(value);
    if (!parsed.success) return null;
    const { designId, revisionId, result } = parsed.data;
    if (result.status === 'ready') {
      const source = await this.files
        .readRevision(canvasId, { designId, revisionId })
        .catch(() => null);
      if (!source) return null;
      if (sourceMapDigest(source, result.elements) !== result.sourceMapDigest) return null;
      for (const element of result.elements) {
        const file = source.get(element.file);
        if (
          !file ||
          element.end > file.length ||
          !file.startsWith(`<${element.tagName}`, element.start) ||
          !/[\s/>]/.test(file[element.start + element.tagName.length + 1] ?? '')
        )
          return null;
      }
    }
    return { designId, revisionId, result };
  }
}

function sourceMapDigest(
  files: ReadonlyMap<string, string>,
  elements: readonly SourceElement[],
): string {
  const sources = [...files].sort(([left], [right]) => {
    if (left === right) return 0;
    return left < right ? -1 : 1;
  });
  const sites = elements.map(({ elementId, file, start, end, tagName, editability }) => [
    elementId,
    file,
    start,
    end,
    tagName,
    editability,
  ]);
  return createHash('sha256')
    .update(JSON.stringify([sources, sites]))
    .digest('hex');
}

function artifactName(artifactId: string): string {
  return `${artifactId}.html`;
}

function outcomeName(revisionId: string): string {
  return `${revisionId}.json`;
}

/**
 * The state the manifest lets this outcome be served as, or null when it does
 * not vouch for it. A published `ready` moved the design's last-working pointer
 * to its own revision in the same commit, so an outcome whose commit never
 * happened can never match that pointer however the cleanup of its file went.
 */
function vouchedState(
  design: PersistedDesign,
  revisionId: string,
  result: BuildResult,
  present: ReadonlySet<string>,
): CanvasBuildOutcome | null {
  if (result.status === 'ready') {
    if (design.lastWorkingRevisionId !== revisionId) return null;
    if (!present.has(artifactName(result.artifactId))) return null;
  }
  return builtState(revisionId, result, design.lastWorkingRevisionId);
}

/** The state one outcome describes, which only ever names its own revision. */
export function builtState(
  revisionId: string,
  result: BuildResult,
  lastWorkingRevisionId: string | null,
): CanvasBuildOutcome {
  if (result.status === 'ready')
    return {
      status: 'ready',
      revisionId,
      artifactId: result.artifactId,
      elements: result.elements,
      diagnostics: result.diagnostics,
    };
  return { status: 'failed', revisionId, diagnostics: result.diagnostics, lastWorkingRevisionId };
}
