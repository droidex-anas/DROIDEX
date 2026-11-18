// The Components tab's rows: which kit catalog entries a search finds, best
// first, and the props an added entry's picks write.

import type { CatalogListing, PropPick } from '../protocol';

/**
 * The entries a search finds, best first: a name starting with it, then a
 * word in a name starting with it, then a name holding it, then its file's
 * name or its note holding it. The catalog's own order breaks ties.
 */
export function paletteRows(catalog: readonly CatalogListing[], query: string): CatalogListing[] {
  const needle = query.trim().toLowerCase();
  if (needle === '') return [...catalog];
  const ranked = catalog.flatMap((entry, index) => {
    const rank = matchRank(entry, needle);
    return rank === null ? [] : [{ entry, rank, index }];
  });
  ranked.sort((a, b) => a.rank - b.rank || a.index - b.index);
  return ranked.map(({ entry }) => entry);
}

function matchRank(entry: CatalogListing, needle: string): number | null {
  const name = entry.name.toLowerCase();
  if (name.startsWith(needle)) return 0;
  if (words(entry.name).some((word) => word.startsWith(needle))) return 1;
  if (name.includes(needle)) return 2;
  const elsewhere = [fileName(entry.module), entry.note].some((text) =>
    text?.toLowerCase().includes(needle),
  );
  return elsewhere ? 3 : null;
}

/** The options an entry's detail has picked, by prop name. */
export type ChosenProps = Readonly<Partial<Record<string, string>>>;

/**
 * The props an add writes for a row's picks: each picked option the entry
 * still lists, where it differs from what the entry writes anyway.
 */
export function propPicks(entry: CatalogListing, chosen: ChosenProps): PropPick[] {
  return entry.props.flatMap(({ name, options, default: written }) => {
    const value = chosen[name];
    if (value === undefined || value === written || !options.includes(value)) return [];
    return [{ name, value }];
  });
}

/** components/ui/alert-dialog.tsx is alert-dialog: the folder and extension match every entry. */
function fileName(module: string | null): string | null {
  return (
    module
      ?.split('/')
      .at(-1)
      ?.replace(/\.[^.]+$/, '') ?? null
  );
}

/** "AlertDialog with icon" is alert, dialog, with and icon; "XMLHttpRequest" is xml, http and request. */
function words(name: string): string[] {
  return name
    .split(/[^A-Za-z0-9]+|(?<=[a-z0-9])(?=[A-Z])|(?<=[A-Z])(?=[A-Z][a-z])/)
    .filter((word) => word !== '')
    .map((word) => word.toLowerCase());
}
