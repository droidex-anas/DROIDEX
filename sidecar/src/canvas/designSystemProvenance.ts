// Where a kit version came from: a canvas revision it was extracted from,
// another kit version it copies, or the project files DROIDEX read it from.
// Provenance is a record only; nothing reads it to build the kit.

import { z } from 'zod';
import { DOCUMENT_LIMITS, tokenNameSchema } from './designSystemDocument.js';
import { MAX_PROJECT_PATH_LENGTH } from './projectPaths.js';
import { canvasIdentifierSchema, designSystemVersionRefSchema } from './schema.js';

/** How many project files a kit may name as its source. */
export const MAX_PROJECT_FILES = 8;

/** How many named exports a library kit records across its component modules. */
export const MAX_LIBRARY_EXPORTS = 1024;

// An identifier a module can export, which `__proto__` cannot match.
const exportNameSchema = z
  .string()
  .max(128)
  .regex(/^[A-Za-z$][\w$]*$/);
const projectPathSchema = z.string().min(1).max(MAX_PROJECT_PATH_LENGTH);

function atMost(max: number) {
  return (record: Record<string, string>) => Object.keys(record).length <= max;
}

/**
 * A kit read from a component library in the project: each primitive the kit
 * exports and the project module it came from, and each kit token and the
 * project token it was read from, so an export back to that project can use
 * the project's own names.
 */
const libraryProvenanceSchema = z
  .object({
    kind: z.literal('shadcn'),
    components: z
      .record(exportNameSchema, projectPathSchema)
      .refine(atMost(MAX_LIBRARY_EXPORTS), 'A library kit records too many exports.'),
    tokens: z
      .record(tokenNameSchema, tokenNameSchema)
      .refine(atMost(DOCUMENT_LIMITS.maxTokens), 'A library kit records too many tokens.'),
  })
  .strict();

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
          files: z.array(projectPathSchema).min(1).max(MAX_PROJECT_FILES),
          library: libraryProvenanceSchema.optional(),
        })
        .strict(),
    })
    .strict(),
]);

export type DesignSystemProvenance = z.infer<typeof designSystemProvenanceSchema>;
