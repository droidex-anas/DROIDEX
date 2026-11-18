// A catalog entry as a module of its own: its imports, one per line, then an
// anonymous default component returning its JSX. The compiler's catalog check
// builds each entry this way, a kit preview shows one the same way, and a frame
// made from an entry starts as one.

import { KIT_SPECIFIER } from './designBundle.js';
import type { CatalogEntry } from './kitCatalog.js';

// Inline styles, because a kit's Tailwind theme may not define the usual
// utilities, and no spacing literal, which a strict kit would refuse. The page
// centres a box that hugs the entry, so the board can size the frame to it.
const FRAME_PAGE = JSON.stringify({
  display: 'flex',
  minHeight: '100vh',
  alignItems: 'center',
  justifyContent: 'center',
});
const ENTRY_BOX = JSON.stringify({
  display: 'inline-flex',
  flexDirection: 'column',
  alignItems: 'flex-start',
  maxWidth: '100%',
});

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

/** A frame's source holding only the entry, written as `jsx`: its own, or with picks written on it. */
export function entryFrameModule(entry: CatalogEntry, jsx: string): string {
  return entryModule(
    entry,
    `<main style={${FRAME_PAGE}}>\n<div style={${ENTRY_BOX}}>\n${jsx}\n</div>\n</main>`,
  );
}
