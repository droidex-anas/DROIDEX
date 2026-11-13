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

/** How many review records a library kit lists; its counts have them all. */
export const MAX_LIBRARY_SKIPS = 128;

/**
 * Why a library import left a file out of the kit, or, for no_exports and
 * duplicate_export, kept a file whose exports the kit entry does not all
 * re-export, and for demo_left_out kept a file whose catalog demo it left out.
 * `detail` names the import for unsupported_import, the left-out sibling for
 * needs_left_out, the exports another file gave the entry for
 * duplicate_export and the variant the library lacks for demo_left_out; it is
 * null otherwise.
 */
const LIBRARY_SKIP_REASONS = [
  'over_limit',
  'unreadable',
  'unsupported_import',
  'needs_left_out',
  'duplicate_export',
  'no_exports',
  'not_a_component',
  'demo_left_out',
] as const;

const DETAILED_SKIP_REASONS = new Set<string>([
  'unsupported_import',
  'needs_left_out',
  'duplicate_export',
  'demo_left_out',
]);

/** The reasons whose file the kit kept; every other reason's file is left out. */
export const KEPT_SKIP_REASONS = new Set<string>([
  'no_exports',
  'duplicate_export',
  'demo_left_out',
]);

/** An absolute path or file: URL, which would carry a folder outside the project into the kit. */
export const HOST_PATH = /^(?:[\\/]|[a-z]:[\\/]|file:)/i;

// An identifier a module can export, which `__proto__` cannot match.
const exportNameSchema = z
  .string()
  .max(128)
  .regex(/^[A-Za-z$][\w$]*$/);
const projectPathSchema = z.string().min(1).max(MAX_PROJECT_PATH_LENGTH);
const reviewTextSchema = projectPathSchema.refine(
  (text) => !HOST_PATH.test(text),
  'A library review names no absolute path.',
);

function atMost(max: number) {
  return (record: Record<string, string>) => Object.keys(record).length <= max;
}

const librarySkipSchema = z
  .object({
    file: reviewTextSchema,
    reason: z.enum(LIBRARY_SKIP_REASONS),
    detail: reviewTextSchema.nullable(),
  })
  .strict()
  .refine(
    (skip) => (skip.detail !== null) === DETAILED_SKIP_REASONS.has(skip.reason),
    'A review record has a detail exactly when its reason names one.',
  );

export type LibrarySkip = z.infer<typeof librarySkipSchema>;

/**
 * A kit read from a component library in the project: each primitive the kit
 * exports and the project module it came from, and each kit token and the
 * project token it was read from, so an export back to that project can use
 * the project's own names. It also reviews the import, one record per file:
 * `skippedCount` counts the files it left out and `partialCount` the files it
 * kept whose exports the entry does not all re-export or whose catalog demo it
 * left out, listed or not.
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
    partialCount: z.number().int().nonnegative().safe(),
  })
  .strict()
  .refine((library) => {
    const kept = library.skipped.filter(({ reason }) => KEPT_SKIP_REASONS.has(reason)).length;
    return kept <= library.partialCount && library.skipped.length - kept <= library.skippedCount;
  }, 'A library kit lists more review records than it counts.')
  .refine(
    (library) => new Set(library.skipped.map(({ file }) => file)).size === library.skipped.length,
    'A library kit reviews a file more than once.',
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
