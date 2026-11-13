// A catalog entry as a module of its own: its imports, one per line, then an
// anonymous default component returning its JSX. The compiler's catalog check
// builds each entry this way, and a kit preview shows one the same way.

import { KIT_SPECIFIER } from './designBundle.js';
import type { CatalogEntry } from './kitCatalog.js';

const ICON_SPECIFIER = 'lucide-react';

export function entryImports(entry: CatalogEntry): { name: string; from: string }[] {
  return [
    ...[...new Set(entry.uses)].map((name) => ({ name, from: KIT_SPECIFIER })),
    ...[...new Set(entry.icons)].map((name) => ({ name, from: ICON_SPECIFIER })),
  ];
}

/** The entry's module, returning `jsx`: the entry's own, or the entry inside a wrapper. */
export function entryModule(entry: CatalogEntry, jsx = entry.jsx): string {
  const header = entryImports(entry).map(({ name, from }) => `import { ${name} } from '${from}';`);
  // Anonymous, so no name of the module's own can shadow one the entry imports.
  header.push('', 'export default function () {', '  return (');
  return `${header.join('\n')}\n${jsx}\n  );\n}\n`;
}
