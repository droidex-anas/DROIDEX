// The kit's files (spec §2): its notes, the example files its cover and
// previews render, and its images, each with where the document shows it.

import type { DocumentSection } from '../designSystemDocumentProtocol';
import type { DesignSystemCover } from '../protocol';

export interface KitFile {
  name: string;
  kind: 'note' | 'example' | 'asset';
  /** The item that shows it and that item's section, the cover, or nothing. */
  shownAt: { itemId: string; section: string } | 'cover' | null;
}

export function kitFiles(
  sections: DocumentSection[],
  cover: DesignSystemCover,
  examples: string[],
): KitFile[] {
  const files: KitFile[] = [];
  const previewOf = new Map<string, { itemId: string; section: string }>();
  for (const section of sections)
    for (const item of section.items) {
      const shownAt = { itemId: item.id, section: section.title };
      if (item.kind === 'note') files.push({ name: item.label, kind: 'note', shownAt });
      if (item.kind === 'asset') files.push({ name: item.name, kind: 'asset', shownAt });
      if (item.kind === 'preview' && !previewOf.has(item.example))
        previewOf.set(item.example, shownAt);
    }
  for (const name of examples) {
    const isCover = cover?.kind === 'preview' && cover.example === name;
    files.push({
      name,
      kind: 'example',
      shownAt: isCover ? 'cover' : (previewOf.get(name) ?? null),
    });
  }
  return files;
}
