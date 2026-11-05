// The nav's search (spec §5): tokens match by name or value, notes by label,
// the title it reads as or text, previews and assets by title. Sections with no
// match drop out.

import type { DocumentSection, DocumentToken } from '../designSystemDocumentProtocol';
import { noteTitle, tokenKey, withItems, type DocumentItem } from './documentSections';

export function searchSections(sections: DocumentSection[], query: string): DocumentSection[] {
  const needle = query.trim().toLowerCase();
  if (needle === '') return sections;
  const matches = (text: string) => text.toLowerCase().includes(needle);
  const tokenMatches = (token: DocumentToken) =>
    matches(token.name) ||
    ('value' in token ? matches(token.value) : matches(token.light) || matches(token.dark));
  return sections.flatMap((section) => {
    const items = section.items.flatMap((item): DocumentItem[] => {
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
    });
    return items.length > 0 ? [withItems(section, items)] : [];
  });
}

/** What a section's count says: its tokens, notes, previews and assets, less those struck out. */
export function itemCount(section: DocumentSection, isRemoved: (key: string) => boolean): number {
  let count = 0;
  for (const item of section.items) {
    if (isRemoved(item.id)) continue;
    if (item.kind !== 'group') count += 1;
    else count += item.tokens.filter((token) => !isRemoved(tokenKey(token.name))).length;
  }
  return count;
}
