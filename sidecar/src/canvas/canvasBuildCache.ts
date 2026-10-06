// The derived build cache of a canvas directory: the artifact document a preview
// loads, the outcome each revision reached, and the build state a restarted
// sidecar can prove from the two. Everything here is rebuildable from canonical
// source (spec §7), so a name that is missing, damaged or no longer parseable is
// a cache miss and never an error. It is also untrusted on the way back in, so
// every entry is revalidated against the current schema.

import { z } from 'zod';
import type { CanvasFiles } from './canvasFiles.js';
import type { CanvasManifest } from './canvasManifest.js';
import type { CanvasBuildState } from './protocol.js';
import { CANVAS_LIMITS, canvasIdentifierSchema } from './schema.js';

const BUILD_OUTCOME_VERSION = 1;

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

const buildResultSchema = z.discriminatedUnion('status', [
  z.object({ status: z.literal('ready'), artifactId: canvasIdentifierSchema }).strict(),
  z
    .object({
      status: z.literal('failed'),
      diagnostics: z.array(diagnosticSchema).max(MAX_BUILD_DIAGNOSTICS),
    })
    .strict(),
]);

const buildOutcomeSchema = z
  .object({
    version: z.literal(BUILD_OUTCOME_VERSION),
    designId: canvasIdentifierSchema,
    revisionId: canvasIdentifierSchema,
    result: buildResultSchema,
  })
  .strict();

/** What one revision's build concluded, as the cache records it. */
export type BuildResult = z.infer<typeof buildResultSchema>;

/** The revision a cached outcome belongs to, and what that outcome was. */
interface CachedOutcome {
  designId: string;
  revisionId: string;
  result: BuildResult;
}

/** One design's build state as this cache can still prove it. */
export interface RestoredBuild {
  canvasId: string;
  designId: string;
  state: CanvasBuildState;
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
  saveOutcome(
    canvasId: string,
    designId: string,
    revisionId: string,
    result: BuildResult,
  ): Promise<void> {
    const document = { version: BUILD_OUTCOME_VERSION, designId, revisionId, result } as const;
    return this.files.writeBuildOutput(
      canvasId,
      outcomeName(revisionId),
      `${JSON.stringify(document)}\n`,
    );
  }

  /** One ready artifact's document, or null once the cache has lost it. */
  async readArtifact(canvasId: string, artifactId: string): Promise<string | null> {
    return this.files.readBuildOutput(canvasId, artifactName(artifactId));
  }

  /**
   * The build state every design on these canvases can be served with. A design
   * is absent when this cache cannot prove anything about its current revision,
   * which leaves the frame `pending` and due a rebuild.
   */
  async restoreStates(manifests: readonly CanvasManifest[]): Promise<RestoredBuild[]> {
    const restored: RestoredBuild[] = [];
    for (const manifest of manifests) {
      const revisionIds = manifest.designs.flatMap((design) =>
        design.revisionId === null ? [] : [design.revisionId],
      );
      // A cache that cannot be read is a cache that gets rebuilt.
      const outcomes = await this.read(manifest.canvasId, revisionIds).catch((error: unknown) => {
        console.error(`Canvas ${manifest.canvasId} build outputs were not read:`, error);
        return null;
      });
      if (!outcomes) continue;
      for (const design of manifest.designs) {
        const outcome = design.revisionId === null ? undefined : outcomes.get(design.revisionId);
        if (outcome?.designId !== design.designId) continue;
        restored.push({
          canvasId: manifest.canvasId,
          designId: design.designId,
          state: builtState(outcome.revisionId, outcome.result, design.lastWorkingRevisionId),
        });
      }
    }
    return restored;
  }

  /**
   * What this cache can still prove about the named revisions, keyed by
   * revision. A `ready` outcome whose artifact document is gone is left out:
   * the frame it belongs to has to be built again.
   */
  private async read(
    canvasId: string,
    revisionIds: readonly string[],
  ): Promise<Map<string, CachedOutcome>> {
    const restored = new Map<string, CachedOutcome>();
    if (revisionIds.length === 0) return restored;
    const present = await this.files.listBuildOutputs(canvasId);
    for (const revisionId of revisionIds) {
      const name = outcomeName(revisionId);
      if (!present.has(name)) continue;
      const outcome = await this.readOutcome(canvasId, name);
      if (outcome?.revisionId !== revisionId) continue;
      if (
        outcome.result.status === 'ready' &&
        !present.has(artifactName(outcome.result.artifactId))
      )
        continue;
      restored.set(revisionId, outcome);
    }
    return restored;
  }

  /** A cache entry we cannot parse is one we cannot use; the frame rebuilds. */
  private async readOutcome(canvasId: string, name: string): Promise<CachedOutcome | null> {
    const text = await this.files.readBuildOutput(canvasId, name);
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
    return { designId, revisionId, result };
  }
}

function artifactName(artifactId: string): string {
  return `${artifactId}.html`;
}

function outcomeName(revisionId: string): string {
  return `${revisionId}.json`;
}

/** The state one outcome describes, which only ever names its own revision. */
export function builtState(
  revisionId: string,
  result: BuildResult,
  lastWorkingRevisionId: string | null,
): CanvasBuildState {
  if (result.status === 'ready')
    return { status: 'ready', revisionId, artifactId: result.artifactId };
  return { status: 'failed', revisionId, diagnostics: result.diagnostics, lastWorkingRevisionId };
}
