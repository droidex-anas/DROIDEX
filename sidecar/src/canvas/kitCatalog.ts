// A kit's catalog: catalog.json in the kit's files, read as data and never run,
// like its project theme. Each entry is one JSX element a palette inserts
// into a frame, with the kit exports and lucide-react icons it names. The
// compiler checks that each stands alone and builds (catalogCheck.ts).

import { z } from 'zod';
import { canvasDiagnosticSchema, truncateDiagnosticText } from './canvasDiagnostics.js';
import type { CanvasDiagnostic } from './protocol.js';
import { sourcePathSchema, type SourceFiles } from './schema.js';

export const KIT_CATALOG_FILE = 'catalog.json';

const CATALOG_LIMITS = {
  maxEntries: 128,
  maxJsxBytes: 4 * 1024,
  maxNameLength: 80,
  maxNoteLength: 200,
  maxNamesPerEntry: 64,
} as const;

const importNameSchema = z
  .string()
  .regex(/^[A-Za-z_$][\w$]*$/, 'Name one export, such as Button')
  .max(CATALOG_LIMITS.maxNameLength);

/** An entry's name, which is unique in its catalog. */
export const catalogNameSchema = z.string().trim().min(1).max(CATALOG_LIMITS.maxNameLength);

const entrySchema = z
  .object({
    name: catalogNameSchema,
    /** The kit file the entry shows, for grouping and search. */
    module: sourcePathSchema.nullable(),
    uses: z.array(importNameSchema).max(CATALOG_LIMITS.maxNamesPerEntry),
    icons: z.array(importNameSchema).max(CATALOG_LIMITS.maxNamesPerEntry),
    jsx: z
      .string()
      .trim()
      .min(1)
      .refine((jsx) => Buffer.byteLength(jsx, 'utf8') <= CATALOG_LIMITS.maxJsxBytes, {
        message: 'An entry holds at most 4 KiB of JSX',
      }),
    note: z.string().trim().min(1).max(CATALOG_LIMITS.maxNoteLength).nullable(),
  })
  .strict();

const catalogSchema = z.array(entrySchema).max(CATALOG_LIMITS.maxEntries);

export type CatalogEntry = z.infer<typeof entrySchema>;

/** A kit check failure, told as the catalog entry it belongs to; `entry` is null for one outside every entry. */
export const kitFailureSchema = z
  .object({ entry: z.string().nullable(), diagnostic: canvasDiagnosticSchema })
  .strict();

export type KitFailure = z.infer<typeof kitFailureSchema>;

/** The catalog a kit carries, none when it has no catalog file, or why the file is unusable. */
export function readKitCatalog(
  files: SourceFiles,
): { catalog: CatalogEntry[] } | { problem: string } {
  if (!Object.hasOwn(files, KIT_CATALOG_FILE)) return { catalog: [] };
  let json: unknown;
  try {
    json = JSON.parse(files[KIT_CATALOG_FILE]);
  } catch {
    return { problem: `${KIT_CATALOG_FILE} is not JSON.` };
  }
  const parsed = catalogSchema.safeParse(json);
  if (!parsed.success) {
    const [issue] = parsed.error.issues;
    const at = issue.path.length > 0 ? ` at ${issue.path.join('.')}` : '';
    return { problem: `${KIT_CATALOG_FILE} is not a catalog${at}: ${issue.message}.` };
  }
  const names = new Set<string>();
  for (const entry of parsed.data) {
    if (names.has(entry.name))
      return { problem: `${KIT_CATALOG_FILE} names two entries ${entry.name}. Rename one.` };
    names.add(entry.name);
    if (entry.module !== null && !Object.hasOwn(files, entry.module))
      return { problem: `${entryLabel(entry.name)}: the kit has no file ${entry.module}.` };
  }
  return { catalog: parsed.data };
}

/** The catalog file holding these entries. */
export function catalogFile(catalog: readonly CatalogEntry[]): string {
  return `${JSON.stringify(catalog, null, 2)}\n`;
}

/** What the kit document lists of an entry; its JSX stays in the sidecar. */
export type CatalogListing = Pick<CatalogEntry, 'name' | 'module' | 'note'>;

/** The listing of a saved version's catalog, which was checked when it was saved. */
export function catalogListing(files: SourceFiles): CatalogListing[] {
  const read = readKitCatalog(files);
  if ('problem' in read) throw new Error(read.problem);
  return read.catalog.map(({ name, module, note }) => ({ name, module, note }));
}

/** Why the kit's catalog file is unusable, or null when it is usable or absent. */
export function catalogProblem(files: SourceFiles): string | null {
  const read = readKitCatalog(files);
  return 'problem' in read ? read.problem : null;
}

/** A failure of one entry, told as that entry's. */
export function entryFailure(
  entry: string,
  { code, message }: Pick<CanvasDiagnostic, 'code' | 'message'>,
): KitFailure {
  return {
    entry,
    diagnostic: {
      code,
      message: truncateDiagnosticText(`${entryLabel(entry)}: ${message}`),
      file: KIT_CATALOG_FILE,
    },
  };
}

function entryLabel(entry: string): string {
  return `${KIT_CATALOG_FILE}, ${entry}`;
}
