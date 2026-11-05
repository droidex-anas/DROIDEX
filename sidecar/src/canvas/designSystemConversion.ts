// Reads the kit versions v1.6.0 and v1.6.1 saved as `{ modes, guidance }` as
// documents (design system documents spec §15), with the same version number so
// frames pinned to them keep building; the next save writes the new shape.
// Delete this module, its two calls in designSystems.ts and its test in the
// first release after the one that ships design system documents.

import { z } from 'zod';
import { buildDocument } from './buildDocument.js';
import { tokenNameSchema, tokenValueSchema } from './designSystemDocument.js';
import type { DesignSystem } from './designSystems.js';
import { canvasIdentifierSchema, sourceFilesSchema } from './schema.js';

const versionFields = {
  id: canvasIdentifierSchema,
  version: z.number().int().positive().safe(),
  name: z.string().min(1).max(120),
};
const swatchSchema = z.object({ surface: tokenValueSchema, accent: tokenValueSchema }).strict();
const legacySummarySchema = z
  .object({
    ...versionFields,
    kind: z.literal('user'),
    swatches: z.object({ light: swatchSchema, dark: swatchSchema }).strict(),
  })
  .strict();
const modeSchema = z.record(tokenNameSchema, tokenValueSchema);
const legacySystemSchema = z
  .object({
    ...versionFields,
    modes: z.object({ light: modeSchema, dark: modeSchema }).strict(),
    files: sourceFilesSchema,
    guidance: z.string(),
    examples: sourceFilesSchema,
    provenance: z
      .union([
        z
          .object({
            sourceCanvasId: canvasIdentifierSchema,
            revision: z
              .object({ designId: canvasIdentifierSchema, revisionId: canvasIdentifierSchema })
              .strict(),
          })
          .strict(),
        z
          .object({
            copiedFrom: z.object({ id: canvasIdentifierSchema, version: z.number() }).strict(),
          })
          .strict(),
      ])
      .optional(),
  })
  .strict();
const legacyVersionSchema = z
  .object({
    summary: legacySummarySchema,
    system: legacySystemSchema,
    mutationId: canvasIdentifierSchema.optional(),
  })
  .strict();

type LegacySummary = z.infer<typeof legacySummarySchema>;

/** A v1.6 version file's header, or null when it is not one. */
export function legacySummary(value: unknown): LegacySummary | null {
  const parsed = legacySummarySchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

/** A whole v1.6 version file as a document, or null when it is not one. */
export function convertLegacyVersion(value: unknown): DesignSystem | null {
  const parsed = legacyVersionSchema.safeParse(value);
  if (!parsed.success) return null;
  const { summary, system } = parsed.data;
  if (
    summary.id !== system.id ||
    summary.version !== system.version ||
    summary.name !== system.name
  )
    return null;
  return {
    id: system.id,
    version: system.version,
    name: system.name,
    cover: null,
    sections: buildDocument({
      tokens: system.modes,
      overview:
        system.guidance.trim() === ''
          ? []
          : [{ kind: 'note', label: 'guidance.md', body: system.guidance }],
    }),
    files: system.files,
    examples: system.examples,
    ...(system.provenance ? { provenance: system.provenance } : {}),
  };
}
