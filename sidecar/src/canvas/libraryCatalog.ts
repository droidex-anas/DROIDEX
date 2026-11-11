// The catalog a kit imported from a shadcn/ui library starts with: shadcn/ui's
// own component demos (libraryCatalogSeeds.json, written from a pinned shadcn/ui
// commit by tools/extract-shadcn-catalog.mjs), with their MIT notice as a file
// of the kit so every copy of the kit carries it. A demo is kept when the import
// kept its module and the kit exports every name it uses; one that then does
// not build is left out with a diagnostic, not refused.

import { kitPrimitives } from './designSystemBrief.js';
import type { DesignSystem } from './designSystems.js';
import {
  catalogFile,
  KIT_CATALOG_FILE,
  readKitCatalog,
  type CatalogEntry,
  type KitFailure,
} from './kitCatalog.js';
import { kitComponentPath } from './libraryComponents.js';
import type { CanvasDiagnostic } from './protocol.js';
import type { SourceFiles } from './schema.js';
import seeds from './libraryCatalogSeeds.json' with { type: 'json' };

export const LIBRARY_CATALOG_NOTICE = 'licenses/shadcn-ui.txt';

const NOTICE = `The demos in ${KIT_CATALOG_FILE} are taken from the component demos of shadcn/ui
(${seeds.source}, commit ${seeds.commit}), used under the MIT License:

${seeds.license}`;

type SeededKit = Pick<DesignSystem, 'files'>;

/** The catalog file and its notice for a library kit's files, or none when no demo fits the kit. */
export function libraryCatalogFiles(files: SourceFiles): SourceFiles {
  const exports = new Set(kitPrimitives({ files }));
  const catalog: CatalogEntry[] = [];
  for (const seed of seeds.entries) {
    const module = kitComponentPath(seed.module);
    if (!Object.hasOwn(files, module) || !seed.uses.every((name) => exports.has(name))) continue;
    catalog.push({ ...seed, module });
  }
  if (catalog.length === 0) return {};
  return { [KIT_CATALOG_FILE]: catalogFile(catalog), [LIBRARY_CATALOG_NOTICE]: NOTICE };
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
