// The catalog a kit imported from a shadcn/ui library starts with: shadcn/ui's
// own component demos (libraryCatalogSeeds.json, written from a pinned shadcn/ui
// commit by tools/extract-shadcn-catalog.mjs), with their MIT notice as a file
// of the kit so every copy of the kit carries it. A demo is kept when the import
// kept its module and the kit exports every name it uses, and left out when it
// gives a component a variant the library's own cva() does not define, which
// the build cannot catch because it does not type-check. A kept demo offers
// its first used component's variants as props (libraryVariants.ts). One that
// then does not build is left out with a diagnostic, not refused.

import type { ComponentVariants, ModuleElement } from './compilerModules.js';
import { kitPrimitives } from './designSystemBrief.js';
import type { LibrarySkip } from './designSystemProvenance.js';
import type { DesignSystem } from './designSystems.js';
import {
  CATALOG_LIMITS,
  catalogFile,
  catalogPropSchema,
  KIT_CATALOG_FILE,
  readKitCatalog,
  type CatalogEntry,
  type CatalogProp,
  type KitFailure,
} from './kitCatalog.js';
import { entryExports, kitComponentPath, type LibraryComponent } from './libraryComponents.js';
import type { CanvasDiagnostic } from './protocol.js';
import type { SourceFiles } from './schema.js';
import seeds from './libraryCatalogSeeds.json' with { type: 'json' };

export const LIBRARY_CATALOG_NOTICE = 'licenses/shadcn-ui.txt';

/** The JSX of each demo, in seed order, for the compiler to read its elements. */
export const LIBRARY_DEMOS: readonly string[] = seeds.entries.map((seed) => seed.jsx);

const NOTICE = `The demos in ${KIT_CATALOG_FILE} are taken from the component demos of shadcn/ui
(${seeds.source}, commit ${seeds.commit}), used under the MIT License:

${seeds.license}`;

type SeededKit = Pick<DesignSystem, 'files'>;
type VariantProps = ComponentVariants['props'];

/**
 * The catalog file and its notice for a library kit's files, none when no
 * demo fits the kit, and a review record for each demo left out for a variant.
 * `exported` names the component file the kit entry exports each name from,
 * and `demos` holds the elements each of LIBRARY_DEMOS writes.
 */
export function libraryCatalogFiles(
  files: SourceFiles,
  components: readonly LibraryComponent[],
  exported: Readonly<Record<string, string>>,
  demos: readonly ModuleElement[][],
  diagnostics: CanvasDiagnostic[],
): { files: SourceFiles; skipped: LibrarySkip[] } {
  const exports = new Set(kitPrimitives({ files }));
  const variants = exportedVariants(components, exported);
  const catalog: CatalogEntry[] = [];
  const skipped: LibrarySkip[] = [];
  seeds.entries.forEach((seed, index) => {
    const module = kitComponentPath(seed.module);
    const component = components.find(({ name }) => name === seed.module);
    if (!component || !Object.hasOwn(files, module)) return;
    if (!seed.uses.every((name) => exports.has(name))) return;
    const used = demos[index].filter(({ tag }) => seed.uses.includes(tag));
    const undefinedVariant = firstUndefinedVariant(used, variants);
    if (undefinedVariant !== null) {
      const { tag, written } = undefinedVariant;
      const detail = `Its demo gives ${tag} ${written}, which the library's ${tag} does not define.`;
      diagnostics.push({
        code: 'invalid_input',
        message: `${KIT_CATALOG_FILE}, ${seed.name}: ${detail} The catalog leaves this demo out.`,
        file: KIT_CATALOG_FILE,
      });
      skipped.push({ file: component.file, reason: 'demo_left_out', detail });
      return;
    }
    const props = entryProps(used.at(0), variants);
    catalog.push({ ...seed, module, ...(props.length > 0 ? { props } : {}) });
  });
  if (catalog.length === 0) return { files: {}, skipped };
  return {
    files: { [KIT_CATALOG_FILE]: catalogFile(catalog), [LIBRARY_CATALOG_NOTICE]: NOTICE },
    skipped,
  };
}

/** Each kit export's variants, as the component file the kit entry exports it from reads them. */
function exportedVariants(
  components: readonly LibraryComponent[],
  exported: Readonly<Record<string, string>>,
): Map<string, VariantProps> {
  const variants = new Map<string, VariantProps>();
  for (const { name, file, module } of components)
    for (const { exportedName, binding } of entryExports(module.exports, name)) {
      if (exported[exportedName] !== file) continue;
      const own = module.variants.find(({ component }) => component === binding);
      if (own !== undefined) variants.set(exportedName, own.props);
    }
  return variants;
}

/** The first quoted value a demo gives a variant its component does not define, as `variant="link"` on Button. */
function firstUndefinedVariant(
  used: readonly ModuleElement[],
  variants: ReadonlyMap<string, VariantProps>,
): { tag: string; written: string } | null {
  for (const { tag, attributes } of used) {
    const props = variants.get(tag) ?? [];
    for (const { name, value } of attributes) {
      const prop = props.find((each) => each.name === name);
      if (prop && value !== null && !prop.options.includes(value))
        return { tag, written: `${name}="${value}"` };
    }
  }
  return null;
}

/**
 * The variants of the element a pick rewrites, each defaulting to the value
 * it writes, else the variant's own default. A variant it writes in code, or
 * may set through a spread, offers no pick.
 */
function entryProps(
  element: ModuleElement | undefined,
  variants: ReadonlyMap<string, VariantProps>,
): CatalogProp[] {
  if (element === undefined || element.spreads) return [];
  const props: CatalogProp[] = [];
  for (const { name, options, default: fallback } of variants.get(element.tag) ?? []) {
    const written = element.attributes.find((attribute) => attribute.name === name);
    if (written?.value === null) continue;
    const prop = catalogPropSchema.safeParse({
      name,
      options,
      default: written?.value ?? fallback,
    });
    if (prop.success) props.push(prop.data);
  }
  return props.slice(0, CATALOG_LIMITS.maxPropsPerEntry);
}

/**
 * The kit without each seeded entry `failures` names, and why each was left
 * out; the catalog and its notice go with the last one.
 */
export function leaveOutFailingSeeds<Kit extends SeededKit>(
  kit: Kit,
  failures: readonly KitFailure[],
): { kit: Kit; diagnostics: CanvasDiagnostic[] } {
  const read = readKitCatalog(kit.files);
  if ('problem' in read) return { kit, diagnostics: [] };
  const failing = new Set(failures.map((failure) => failure.entry));
  const kept = read.catalog.filter((entry) => !failing.has(entry.name));
  const files = { ...kit.files, [KIT_CATALOG_FILE]: catalogFile(kept) };
  const left = kept.length > 0 ? files : withoutCatalog(files);
  const diagnostics = failures.map(({ diagnostic }) => ({
    ...diagnostic,
    message: `${diagnostic.message} The catalog leaves this demo out.`,
  }));
  return { kit: { ...kit, files: left }, diagnostics };
}

function withoutCatalog(files: SourceFiles): SourceFiles {
  return Object.fromEntries(
    Object.entries(files).filter(
      ([path]) => path !== KIT_CATALOG_FILE && path !== LIBRARY_CATALOG_NOTICE,
    ),
  );
}
