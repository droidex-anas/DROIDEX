// Where a kit version came from: a canvas revision it was extracted from,
// another kit version it copies, or the project files DROIDEX read it from.
// Provenance is a record only; nothing reads it to build the kit.

import { z } from 'zod';
import { MAX_PROJECT_PATH_LENGTH } from './projectPaths.js';
import { canvasIdentifierSchema, designSystemVersionRefSchema } from './schema.js';

/** How many project files a kit may name as its source. */
export const MAX_PROJECT_FILES = 8;

export const designSystemProvenanceSchema = z.union([
  z
    .object({
      sourceCanvasId: canvasIdentifierSchema,
      revision: z
        .object({ designId: canvasIdentifierSchema, revisionId: canvasIdentifierSchema })
        .strict(),
    })
    .strict(),
  z.object({ copiedFrom: designSystemVersionRefSchema }).strict(),
  z
    .object({
      project: z
        .object({
          name: z.string().min(1).max(255),
          files: z
            .array(z.string().min(1).max(MAX_PROJECT_PATH_LENGTH))
            .min(1)
            .max(MAX_PROJECT_FILES),
        })
        .strict(),
    })
    .strict(),
]);

export type DesignSystemProvenance = z.infer<typeof designSystemProvenanceSchema>;
