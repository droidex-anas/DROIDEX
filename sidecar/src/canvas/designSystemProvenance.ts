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

/** How many of the files a library import left out its kit lists; `skippedCount` has them all. */
export const MAX_LIBRARY_SKIPS = 128;

/**
 * Why a library import left a file, or one export of a file, out of the kit.
 * `detail` names the import for unsupported_import, the left-out sibling for
 * needs_left_out and the export for duplicate_export; it is null otherwise.
 */
const LIBRARY_SKIP_REASONS = [
  'over_limit',
  'unreadable',
  'unsupported_import',
  'needs_left_out',
  'duplicate_export',
  'no_exports',
  'not_a_component',
] as const;

const DETAILED_SKIP_REASONS = new Set<string>([
  'unsupported_import',
  'needs_left_out',
  'duplicate_export',
]);

// An identifier a module can export, which `__proto__` cannot match.
const exportNameSchema = z
  .string()
  .max(128)
  .regex(/^[A-Za-z$][\w$]*$/);
const projectPathSchema = z.string().min(1).max(MAX_PROJECT_PATH_LENGTH);

function atMost(max: number) {
  return (record: Record<string, string>) => Object.keys(record).length <= max;
}

const librarySkipSchema = z
  .object({
    file: projectPathSchema,
    reason: z.enum(LIBRARY_SKIP_REASONS),
    detail: z.string().min(1).max(MAX_PROJECT_PATH_LENGTH).nullable(),
  })
  .strict()
  .refine(
    (skip) => (skip.detail !== null) === DETAILED_SKIP_REASONS.has(skip.reason),
    'A left-out file has a detail exactly when its reason names one.',
  );

export type LibrarySkip = z.infer<typeof librarySkipSchema>;

/**
 * A kit read from a component library in the project: each primitive the kit
 * exports and the project module it came from, and each kit token and the
 * project token it was read from, so an export back to that project can use
 * the project's own names. It also lists what the import left out, by file.
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
    skipped: z.array(librarySkipSchema).max(MAX_LIBRARY_SKIPS),
    skippedCount: z.number().int().nonnegative().safe(),
  })
  .strict()
  .refine(
    (library) => library.skippedCount >= library.skipped.length,
    'A library kit lists more left-out files than it counts.',
  );

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
