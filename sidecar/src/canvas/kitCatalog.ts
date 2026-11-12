// A kit's catalog: catalog.json in the kit's files, read as data and never run,
// like its project theme. Each entry is one JSX element a palette inserts
// into a frame, or an agent writes after canvas_theme catalog reads it, with
// the kit exports and lucide-react icons it names and the props a palette lets
// the user pick before it inserts. The compiler checks
// that each stands alone and builds (catalogCheck.ts).

import { z } from 'zod';
import { canvasDiagnosticSchema, truncateDiagnosticText } from './canvasDiagnostics.js';
import { canvasError } from './canvasError.js';
import type { CanvasDiagnostic } from './protocol.js';
import { hasDuplicate, sourcePathSchema, type SourceFiles } from './schema.js';

export const KIT_CATALOG_FILE = 'catalog.json';

export const CATALOG_LIMITS = {
  maxEntries: 128,
  maxJsxBytes: 4 * 1024,
  maxNameLength: 80,
  maxNoteLength: 200,
  maxNamesPerEntry: 64,
  maxPropsPerEntry: 8,
  maxOptionsPerProp: 32,
} as const;

const importNameSchema = z
  .string()
  .regex(/^[A-Za-z_$][\w$]*$/, 'Name one export, such as Button')
  .max(CATALOG_LIMITS.maxNameLength);

/** An entry's name, which is unique in its catalog. */
export const catalogNameSchema = z.string().trim().min(1).max(CATALOG_LIMITS.maxNameLength);

/** A value an attribute carries in quotes, as `outline` in `variant="outline"`. */
const propOptionSchema = z
  .string()
  .regex(/^[A-Za-z0-9][\w-]*$/, 'Name an option with letters, digits, - and _, such as outline')
  .max(40);

/** An attribute a palette lets the user pick a value of before it inserts the entry. */
export const catalogPropSchema = z
  .object({
    name: importNameSchema,
    options: z.array(propOptionSchema).min(2).max(CATALOG_LIMITS.maxOptionsPerProp),
    default: propOptionSchema,
  })
  .strict()
  .refine((prop) => !hasDuplicate(prop.options), { message: 'A prop lists each option once' })
  .refine((prop) => prop.options.includes(prop.default), {
    message: "A prop's default is one of its options",
  });

export type CatalogProp = z.infer<typeof catalogPropSchema>;

/** The values an insert picks for an entry's props, each prop at most once. */
export const propPicksSchema = z
  .array(z.object({ name: importNameSchema, value: propOptionSchema }).strict())
  .max(CATALOG_LIMITS.maxPropsPerEntry)
  .refine((picks) => !hasDuplicate(picks.map((pick) => pick.name)), {
    message: 'An insert picks each prop once',
  });

export type PropPick = z.infer<typeof propPicksSchema>[number];

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
    /**
     * The props of its first element written with a component it uses, as
     * that component's variants define them; the default is the value the
     * element writes, else the variant's own default.
     */
    props: z
      .array(catalogPropSchema)
      .max(CATALOG_LIMITS.maxPropsPerEntry)
      .refine((props) => !hasDuplicate(props.map((prop) => prop.name)), {
        message: 'An entry lists each prop once',
      })
      .optional(),
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
export interface CatalogListing {
  name: string;
  module: string | null;
  note: string | null;
  props: CatalogProp[];
}

/** The listing of a saved version's catalog, which was checked when it was saved. */
export function catalogListing(files: SourceFiles): CatalogListing[] {
  const read = readKitCatalog(files);
  if ('problem' in read) throw new Error(read.problem);
  return read.catalog.map(({ name, module, note, props }) => ({
    name,
    module,
    note,
    props: props ?? [],
  }));
}

/** The entries a catalog read names, in catalog order, and the names past its byte budget. */
export interface CatalogRead {
  entries: CatalogEntryRead[];
  /** Entries left out to keep the read bounded, to ask for by name. */
  omitted?: string[];
}

/** An entry as an agent writes it into a design. */
export type CatalogEntryRead = Omit<CatalogEntry, 'module' | 'props'> & { props: CatalogProp[] };

/**
 * What a catalog read's entries may cost as JSON, brackets and commas included.
 * The first entry asked for always comes back, whatever its size, so none is
 * out of reach; the budget bounds the entries after it.
 */
const CATALOG_READ_BYTES = 16 * 1024;

/**
 * The entries of a kit's catalog that `names` asks for, or all of them. A name
 * matches the entry of that name, ignoring case, and the entries filed under
 * it: "Button" also matches "Button / outline", never "Button group".
 */
export function readCatalogEntries(
  files: SourceFiles,
  names: readonly string[] | undefined,
): CatalogRead {
  const read = readKitCatalog(files);
  if ('problem' in read) throw canvasError('invalid_source', read.problem);
  const { catalog } = read;
  const missing = names?.find((name) => !catalog.some((entry) => isNamedBy(entry.name, name)));
  if (missing !== undefined)
    throw canvasError(
      'invalid_input',
      `This kit has no component called ${missing}. Read the catalog without entries to see its components.`,
    );
  const asked =
    names === undefined
      ? catalog
      : catalog.filter((entry) => names.some((name) => isNamedBy(entry.name, name)));
  let used = '[]'.length;
  const entries: CatalogEntryRead[] = [];
  const omitted: string[] = [];
  for (const { name, uses, icons, jsx, note, props } of asked) {
    const entry = { name, uses, icons, jsx, note, props: props ?? [] };
    const separator = entries.length > 0 ? 1 : 0;
    const cost = Buffer.byteLength(JSON.stringify(entry), 'utf8') + separator;
    if (omitted.length > 0 || (entries.length > 0 && used + cost > CATALOG_READ_BYTES)) {
      omitted.push(name);
      continue;
    }
    used += cost;
    entries.push(entry);
  }
  return omitted.length > 0 ? { entries, omitted } : { entries };
}

function isNamedBy(entryName: string, name: string): boolean {
  const entry = entryName.toLowerCase();
  const asked = name.toLowerCase();
  return entry === asked || entry.startsWith(`${asked} / `);
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
