// The catalog a kit imported from a shadcn/ui library starts with: shadcn/ui's
// own component demos (libraryCatalogSeeds.json, written from a pinned shadcn/ui
// commit by tools/extract-shadcn-catalog.mjs; MIT, see NOTICE). A demo is kept
// when the import kept its module and the kit exports every name it uses; one
// that then does not build is left out with a diagnostic, not refused.

import { kitPrimitives } from './designSystemBrief.js';
import type { DesignSystem } from './designSystems.js';
import { catalogFile, KIT_CATALOG_FILE, readKitCatalog, type CatalogEntry } from './kitCatalog.js';
import type { KitPreviews } from './kitPreviews.js';
import { kitComponentPath } from './libraryComponents.js';
import type { CanvasDiagnostic } from './protocol.js';
import type { SourceFiles } from './schema.js';
import seeds from './libraryCatalogSeeds.json' with { type: 'json' };

type SeededKit = Pick<DesignSystem, 'files' | 'sections'>;

/** The catalog file for a library kit's files, or null when no demo fits the kit. */
export function seedLibraryCatalog(files: SourceFiles): string | null {
  const exports = new Set(kitPrimitives({ files }));
  const catalog: CatalogEntry[] = [];
  for (const seed of seeds.entries) {
    const module = kitComponentPath(seed.module);
    if (!Object.hasOwn(files, module) || !seed.uses.every((name) => exports.has(name))) continue;
    catalog.push({ ...seed, module });
  }
  return catalog.length === 0 ? null : catalogFile(catalog);
}

/** The kit with every seeded entry that does not build left out, and why each was. */
export async function keepBuildingSeeds<Kit extends SeededKit>(
  kit: Kit,
  kits: Pick<KitPreviews, 'checkCatalog'>,
): Promise<{ kit: Kit; diagnostics: CanvasDiagnostic[] }> {
  const failures = (await kits.checkCatalog(kit)).filter((failure) => failure.entry !== null);
  const read = readKitCatalog(kit.files);
  if (failures.length === 0 || 'problem' in read) return { kit, diagnostics: [] };
  const failing = new Set(failures.map((failure) => failure.entry));
  const kept = read.catalog.filter((entry) => !failing.has(entry.name));
  const others = Object.entries(kit.files).filter(([path]) => path !== KIT_CATALOG_FILE);
  if (kept.length > 0) others.push([KIT_CATALOG_FILE, catalogFile(kept)]);
  const files = Object.fromEntries(others);
  const diagnostics = failures.map(({ diagnostic }) => ({
    ...diagnostic,
    message: `${diagnostic.message} The catalog leaves this demo out.`,
  }));
  return { kit: { ...kit, files }, diagnostics };
}
