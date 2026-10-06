// The derived build cache of a canvas directory: the artifact document a preview
// loads, the outcome each revision reached, and the build state a restarted
// sidecar can prove from the two. Everything here is rebuildable from canonical
// source (spec §7), so a name that is missing, damaged or no longer parseable is
// a cache miss and never an error. It is also untrusted on the way back in, so
// every entry is revalidated against the current schema.

import { z } from 'zod';
import type { CanvasFiles } from './canvasFiles.js';
import type { CanvasManifest, PersistedDesign } from './canvasManifest.js';
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

  /** Takes back an outcome whose build lost its frame while it was writing. */
  discardOutcome(canvasId: string, revisionId: string): Promise<void> {
    return this.files.removeBuildOutput(canvasId, outcomeName(revisionId));
  }

  /** One ready artifact's document, or null once the cache has lost it. */
  async readArtifact(canvasId: string, artifactId: string): Promise<string | null> {
    return this.files.readBuildOutput(canvasId, artifactName(artifactId));
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
      const present = await this.files
        .listBuildOutputs(manifest.canvasId)
        .catch((error: unknown) => {
          console.error(`Canvas ${manifest.canvasId} build outputs were not read:`, error);
          return null;
        });
      if (!present) continue;
      for (const design of manifest.designs) {
        const revisionId = design.revisionId;
        if (revisionId === null || !present.has(outcomeName(revisionId))) continue;
        const outcome = await this.readOutcome(manifest.canvasId, outcomeName(revisionId));
        if (outcome?.designId !== design.designId || outcome.revisionId !== revisionId) continue;
        const state = vouchedState(design, revisionId, outcome.result, present);
        if (!state) continue;
        restored.push({ canvasId: manifest.canvasId, designId: design.designId, state });
      }
    }
    return restored;
  }

  /** A cache entry we cannot read or parse is one we cannot use; it rebuilds. */
  private async readOutcome(canvasId: string, name: string): Promise<CachedOutcome | null> {
    const text = await this.files.readBuildOutput(canvasId, name).catch((error: unknown) => {
      console.error(`Canvas ${canvasId} build outcome ${name} was not read:`, error);
      return null;
    });
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
): CanvasBuildState | null {
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
): CanvasBuildState {
  if (result.status === 'ready')
    return { status: 'ready', revisionId, artifactId: result.artifactId };
  return { status: 'failed', revisionId, diagnostics: result.diagnostics, lastWorkingRevisionId };
}
