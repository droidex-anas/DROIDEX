// A kit's catalog: catalog.json in the kit's files, read as data and never run,
// like its project theme. Each entry is one JSX expression a palette inserts
// into a frame, with the kit exports and lucide-react icons it names. The kit
// check compiles every entry at once as one module, so a failure on an entry's
// lines is told as that entry's.

import { z } from 'zod';
import { DESIGN_ENTRY } from './designEntry.js';
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

const entrySchema = z
  .object({
    name: z.string().trim().min(1).max(CATALOG_LIMITS.maxNameLength),
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

/** A catalog failure, told as the entry it belongs to; `entry` is null for one outside every entry. */
export interface CatalogFailure {
  entry: string | null;
  diagnostic: CanvasDiagnostic;
}

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

export function catalogListing(files: SourceFiles): CatalogListing[] {
  const read = readKitCatalog(files);
  // A saved version's catalog was checked when it was saved.
  if ('problem' in read) return [];
  return read.catalog.map(({ name, module, note }) => ({ name, module, note }));
}

/** Why the kit's catalog file is unusable, or null when it is usable or absent. */
export function catalogProblem(files: SourceFiles): string | null {
  const read = readKitCatalog(files);
  return 'problem' in read ? read.problem : null;
}

/** Each name an entry uses that the kit entry does not export. */
export function unexportedUses(
  catalog: readonly CatalogEntry[],
  exports: ReadonlySet<string>,
): CatalogFailure[] {
  return catalog.flatMap((entry) =>
    entry.uses
      .filter((name) => !exports.has(name))
      .map((name) =>
        entryFailure(entry.name, {
          code: 'invalid_input',
          message: `${name} is not exported by the kit. Use a name its index.tsx exports.`,
        }),
      ),
  );
}

/** The catalog as one design module, and the entry each of its lines belongs to. */
export interface CatalogModule {
  source: string;
  /** By line, from line 1; null for a line no entry wrote. */
  owners: (string | null)[];
}

/**
 * Every entry as a child of one fragment, each name imported once on its own
 * line by the first entry that names it.
 */
export function catalogModule(catalog: readonly CatalogEntry[]): CatalogModule {
  const lines: string[] = [];
  const owners: (string | null)[] = [];
  const add = (line: string, owner: string | null) => {
    lines.push(line);
    owners.push(owner);
  };
  const imported = new Set<string>();
  const addImport = (name: string, from: string, owner: string) => {
    const key = `${from}:${name}`;
    if (imported.has(key)) return;
    imported.add(key);
    add(`import { ${name} } from '${from}';`, owner);
  };
  for (const entry of catalog) {
    for (const name of entry.uses) addImport(name, '@droidex/design-system', entry.name);
    for (const name of entry.icons) addImport(name, 'lucide-react', entry.name);
  }
  add('', null);
  add('export default function Catalog() {', null);
  add('  return (', null);
  add('    <>', null);
  for (const entry of catalog) {
    // Parentheses hold the entry to one expression.
    add('      {(', entry.name);
    for (const line of entry.jsx.split('\n')) add(line, entry.name);
    add('      )}', entry.name);
  }
  add('    </>', null);
  add('  );', null);
  add('}', null);
  return { source: `${lines.join('\n')}\n`, owners };
}

/** A diagnostic from compiling the catalog module, told as the entry its line belongs to. */
export function catalogCompileFailure(
  module: CatalogModule,
  diagnostic: CanvasDiagnostic,
): CatalogFailure {
  // A kit file's own failure keeps its path: the catalog only exposed it.
  if (diagnostic.file !== DESIGN_ENTRY) return { entry: null, diagnostic };
  const owner = diagnostic.line === undefined ? null : (module.owners[diagnostic.line - 1] ?? null);
  if (owner === null)
    return {
      entry: null,
      diagnostic: { code: diagnostic.code, message: diagnostic.message, file: KIT_CATALOG_FILE },
    };
  return entryFailure(owner, diagnostic);
}

function entryFailure(
  entry: string,
  { code, message }: Pick<CanvasDiagnostic, 'code' | 'message'>,
): CatalogFailure {
  return {
    entry,
    diagnostic: { code, message: `${entryLabel(entry)}: ${message}`, file: KIT_CATALOG_FILE },
  };
}

function entryLabel(entry: string): string {
  return `${KIT_CATALOG_FILE}, ${entry}`;
}
