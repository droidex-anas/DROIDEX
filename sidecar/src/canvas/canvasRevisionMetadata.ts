import { z } from 'zod';
import { canvasIdentifierSchema, designSystemRefSchema, sourcePathSchema } from './schema.js';

export const REVISION_METADATA_VERSION = 1;

// The file inventory is canonical; readers never discover source names on disk.
export const revisionMetadataSchema = z
  .object({
    version: z.literal(REVISION_METADATA_VERSION),
    designId: canvasIdentifierSchema,
    revisionId: canvasIdentifierSchema,
    parentRevisionId: canvasIdentifierSchema.nullable(),
    designSystem: designSystemRefSchema,
    createdAt: z.number().int().nonnegative(),
    files: z.array(sourcePathSchema),
  })
  .strict();

export type RevisionMetadata = z.infer<typeof revisionMetadataSchema>;
export type NewRevision = Omit<RevisionMetadata, 'files'>;
