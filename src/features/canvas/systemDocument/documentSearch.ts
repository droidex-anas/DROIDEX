// The nav's search (spec §5): tokens match by name or value, notes by label,
// the title it reads as or text, previews and assets by title, and catalog
// entries by name, module or note. Sections with no match drop out.

import type { DocumentSection, DocumentToken } from '../designSystemDocumentProtocol';
import type { CatalogListing } from '../protocol';
import { noteTitle, tokenKey, withItems, type DocumentItem } from './documentSections';

/** A section as the document shows it; the Components section also lists the kit's catalog. */
export type ShownSection = DocumentSection & { catalog?: readonly CatalogListing[] };

/** The Components section a kit without one lists its catalog in; no document id has an underscore. */
export const CATALOG_SECTION_ID = '_catalog';

export function searchSections(
  sections: DocumentSection[],
  catalog: readonly CatalogListing[],
  isRemoved: (key: string) => boolean,
  query: string,
): ShownSection[] {
  const needle = query.trim().toLowerCase();
  const matches = (text: string | null) => text?.toLowerCase().includes(needle) ?? false;
  const tokenMatches = (token: DocumentToken) =>
    matches(token.name) ||
    ('value' in token ? matches(token.value) : matches(token.light) || matches(token.dark));
  const itemMatches = (item: DocumentItem): DocumentItem[] => {
    switch (item.kind) {
      case 'group': {
        const tokens = item.tokens.filter(tokenMatches);
        return tokens.length > 0 ? [{ ...item, tokens }] : [];
      }
      case 'note':
        return matches(item.label) || matches(noteTitle(item.label)) || matches(item.body)
          ? [item]
          : [];
      case 'preview':
        return matches(item.title) ? [item] : [];
      case 'asset':
        return matches(item.name) ? [item] : [];
    }
  };
  const listed = catalog.filter(
    (entry) => matches(entry.name) || matches(entry.module) || matches(entry.note),
  );
  // The catalog is the saved kit's, so a draft removing the Components section does not hide it.
  const canHold = (section: DocumentSection) =>
    section.kind === 'components' && !isRemoved(section.id);
  const all = withCatalogSection(sections, catalog, canHold);
  const holder = all.find(canHold);
  return all.flatMap((section): ShownSection[] => {
    const isHolder = section === holder;
    if (needle === '') return [isHolder ? { ...section, catalog } : section];
    const items = section.items.flatMap(itemMatches);
    if (items.length === 0 && !(isHolder && listed.length > 0)) return [];
    const kept = withItems(section, items);
    return [isHolder ? { ...kept, catalog: listed } : kept];
  });
}

/** What a section's count says: its tokens, notes, previews, assets and catalog entries, less those struck out. */
export function itemCount(section: ShownSection, isRemoved: (key: string) => boolean): number {
  let count = section.catalog?.length ?? 0;
  for (const item of section.items) {
    if (isRemoved(item.id)) continue;
    if (item.kind !== 'group') count += 1;
    else count += item.tokens.filter((token) => !isRemoved(tokenKey(token.name))).length;
  }
  return count;
}

// A library kit has no Components section, so its catalog gets one, before its assets.
function withCatalogSection(
  sections: DocumentSection[],
  catalog: readonly CatalogListing[],
  canHold: (section: DocumentSection) => boolean,
): DocumentSection[] {
  if (catalog.length === 0 || sections.some(canHold)) return sections;
  const derived: DocumentSection = {
    kind: 'components',
    id: CATALOG_SECTION_ID,
    title: 'Components',
    items: [],
  };
  const assetsAt = sections.findIndex((section) => section.kind === 'assets');
  if (assetsAt < 0) return [...sections, derived];
  return [...sections.slice(0, assetsAt), derived, ...sections.slice(assetsAt)];
}
