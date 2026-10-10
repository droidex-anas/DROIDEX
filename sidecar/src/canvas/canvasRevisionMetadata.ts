// What Canvas keeps about each immutable revision: the metadata stored with its
// tree, and its entry in the manifest's commit index.

import { createHash } from 'node:crypto';
import { z } from 'zod';
import type { CanvasManifest } from './canvasManifest.js';
import type { CanvasScope, RevisionAuthor, RevisionSummary } from './protocol.js';
import { canvasIdentifierSchema, designSystemRefSchema, sourcePathSchema } from './schema.js';

export const REVISION_METADATA_VERSION = 1;

// The file inventory is canonical; readers never discover source names on disk.
export const revisionMetadataSchema = z
  .object({
    version: z.literal(REVISION_METADATA_VERSION),
    designId: canvasIdentifierSchema,
    revisionId: canvasIdentifierSchema,
    parentRevisionId: canvasIdentifierSchema.nullable(),
    restoredFromRevisionId: canvasIdentifierSchema.optional(),
    designSystem: designSystemRefSchema,
    createdAt: z.number().int().nonnegative(),
    files: z.array(sourcePathSchema),
  })
  .strict();

export type RevisionMetadata = z.infer<typeof revisionMetadataSchema>;
export type NewRevision = Omit<RevisionMetadata, 'files'>;

export interface SavedRevision {
  files: Map<string, string>;
  designSystem: RevisionMetadata['designSystem'];
}

// One manifest commit-index entry; the author never exposes a raw scope ID.
export const revisionRecordSchema = z
  .object({
    designId: canvasIdentifierSchema,
    revisionId: canvasIdentifierSchema,
    restoredFromRevisionId: canvasIdentifierSchema.optional(),
    sequence: z.number().int().positive(),
    author: z.discriminatedUnion('kind', [
      z.object({ kind: z.literal('user') }).strict(),
      z.object({ kind: z.literal('agent'), scopeRef: canvasIdentifierSchema }).strict(),
    ]),
    mutationKind: z.enum(['create', 'write', 'edit', 'restore']),
  })
  .strict();

/** Records only revisions whose manifest commit will publish them. */
export function recordRevisions(
  manifest: CanvasManifest,
  scope: CanvasScope,
  mutationKind: RevisionSummary['mutationKind'],
  designs: readonly {
    designId: string;
    revisionId: string | null;
    restoredFromRevisionId?: string;
  }[],
): void {
  const author: RevisionAuthor =
    scope.origin === 'user'
      ? { kind: 'user' }
      : {
          kind: 'agent',
          scopeRef: `scope-${createHash('sha256').update(scope.scopeId).digest('hex')}`,
        };
  for (const design of designs) {
    if (design.revisionId === null) continue;
    manifest.revisions.push({
      designId: design.designId,
      revisionId: design.revisionId,
      restoredFromRevisionId: design.restoredFromRevisionId,
      sequence: manifest.sequence,
      author,
      mutationKind,
    });
  }
}

export function hasOrderedRevisions(manifest: {
  sequence: number;
  revisions: { sequence: number }[];
}): boolean {
  let previous = 0;
  for (const revision of manifest.revisions) {
    if (revision.sequence < previous || revision.sequence > manifest.sequence) return false;
    previous = revision.sequence;
  }
  return true;
}
