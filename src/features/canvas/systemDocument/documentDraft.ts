// The unsaved edits of a kit's document (spec §6): one draft per kit for the
// app session, based on the version it was opened at. Reading the kit again
// never touches a draft; only Save or Discard ends one.

import { useSyncExternalStore } from 'react';
import type {
  DocumentAsset,
  DocumentNote,
  DocumentPreview,
  DocumentSection,
  DocumentToken,
  TokenGroup,
} from '../designSystemDocumentProtocol';
import { MAX_ASSETS } from '../designSystemDocumentValidation';
import {
  draftDiff,
  itemsById,
  tokenNameOf,
  tokensByName,
  withItems,
  type DocumentItem,
  type SectionKind,
} from './documentSections';
import type { DesignSystemCover, DesignSystemDocumentView } from '../protocol';

export interface DocumentDraft {
  base: DesignSystemDocumentView;
  name: string;
  cover: DesignSystemCover;
  sections: DocumentSection[];
}

/**
 * One edit the document view makes. A `key` names a section or item by id, or
 * a token by `tokenKey(name)`, the same keys `draftDiff` marks.
 */
export type DraftChange =
  | { kind: 'setName'; name: string }
  | { kind: 'setCover'; cover: DesignSystemCover }
  | { kind: 'setToken'; token: DocumentToken }
  | { kind: 'addToken'; groupId: string; token: DocumentToken }
  | { kind: 'setItem'; item: DocumentNote | DocumentPreview | DocumentAsset }
  | { kind: 'addItem'; sectionId: string; item: DocumentItem; before?: string }
  | { kind: 'addSection'; section: DocumentSection }
  | { kind: 'retitle'; id: string; title: string }
  | { kind: 'move'; key: string; by: -1 | 1 }
  | { kind: 'remove'; key: string }
  | { kind: 'restore'; key: string };

/** The canonical order of spec §2, which a new section is inserted by. */
const SECTION_ORDER: readonly SectionKind[] = [
  'notes',
  'colors',
  'typography',
  'spacing',
  'radius',
  'shadows',
  'size',
  'z-index',
  'motion',
  'tokens',
  'components',
  'assets',
];

const SECTION_TITLES: Record<SectionKind, string> = {
  notes: 'Notes',
  colors: 'Colors',
  typography: 'Typography',
  spacing: 'Spacing',
  radius: 'Corner radius',
  shadows: 'Shadows',
  size: 'Size',
  'z-index': 'Z index',
  motion: 'Motion',
  tokens: 'Other tokens',
  components: 'Components',
  assets: 'Assets',
};

export function draftOf(view: DesignSystemDocumentView): DocumentDraft {
  return { base: view, name: view.name, cover: view.cover, sections: view.sections };
}

function applyDraftChange(draft: DocumentDraft, change: DraftChange): DocumentDraft {
  const sections = draft.sections;
  switch (change.kind) {
    case 'setName':
      return { ...draft, name: change.name };
    case 'setCover':
      return { ...draft, cover: change.cover };
    case 'setToken':
      return {
        ...draft,
        sections: mapGroups(sections, (group) => ({
          ...group,
          tokens: group.tokens.map((token) =>
            token.name === change.token.name ? change.token : token,
          ),
        })),
      };
    case 'addToken':
      return {
        ...draft,
        sections: mapGroups(sections, (group) =>
          group.id === change.groupId
            ? { ...group, tokens: [...group.tokens, change.token] }
            : group,
        ),
      };
    case 'setItem':
      return {
        ...draft,
        sections: mapItems(sections, (item) => (item.id === change.item.id ? change.item : item)),
      };
    case 'addItem':
      return {
        ...draft,
        sections: sections.map((section) => {
          if (section.id !== change.sectionId) return section;
          const items = [...section.items];
          // Without `before` the item joins the section's end.
          const at =
            change.before === undefined ? -1 : items.findIndex((item) => item.id === change.before);
          if (at < 0) items.push(change.item);
          else items.splice(at, 0, change.item);
          return withItems(section, items);
        }),
      };
    case 'addSection':
      return { ...draft, sections: insertSection(sections, change.section) };
    case 'retitle':
      return {
        ...draft,
        sections: mapItems(
          sections.map((section) =>
            section.id === change.id ? { ...section, title: change.title } : section,
          ),
          (item) =>
            item.kind === 'group' && item.id === change.id
              ? { ...item, title: change.title }
              : item,
        ),
      };
    case 'move':
      return { ...draft, sections: moved(sections, change.key, change.by) };
    case 'remove':
      return { ...draft, sections: removed(sections, change.key) };
    case 'restore':
      return { ...draft, sections: restored(draft.base.sections, sections, change.key) };
  }
}

/** How many unsaved changes the save bar counts. */
export function changeCount(draft: DocumentDraft): number {
  const { base } = draft;
  return (
    draftDiff(base.sections, draft.sections).size +
    (draft.name === base.name ? 0 : 1) +
    (sameCover(draft.cover, base.cover) ? 0 : 1)
  );
}

/** A new empty note whose id and label nothing in the draft or its base uses. */
export function freshNote(draft: DocumentDraft): DocumentNote {
  const { ids, labels } = takenKeys(draft);
  let n = 1;
  while (ids.has(`note-${String(n)}`) || labels.has(`note-${String(n)}.md`)) n += 1;
  const id = `note-${String(n)}`;
  return { kind: 'note', id, label: `${id}.md`, body: '', author: 'user' };
}

export function freshGroup(draft: DocumentDraft, title: string): TokenGroup {
  return {
    kind: 'group',
    id: freshId(idStem(title) || 'group', takenKeys(draft).ids),
    title,
    tokens: [],
  };
}

/**
 * An entry for an imported image, named `name`, or `name 2` and on when another
 * asset has it; null when the draft already holds as many as a version can.
 */
export function freshAsset(
  draft: DocumentDraft,
  assetId: string,
  name: string,
): DocumentAsset | null {
  const held = draft.sections.flatMap((section): DocumentItem[] => section.items);
  if (held.filter((item) => item.kind === 'asset').length >= MAX_ASSETS) return null;
  const { ids, assetNames } = takenKeys(draft);
  let title = name;
  for (let n = 2; assetNames.has(title); n += 1) title = `${name} ${String(n)}`;
  return { kind: 'asset', id: freshId(idStem(name) || 'image', ids), name: title, assetId };
}

export function freshSection(draft: DocumentDraft, kind: SectionKind): DocumentSection {
  const id = freshId(kind, takenKeys(draft).ids);
  // An empty section of any kind is valid; TypeScript cannot pair `kind` with its item type.
  return { kind, id, title: SECTION_TITLES[kind], items: [] };
}

const drafts = new Map<string, DocumentDraft>();
const listeners = new Set<() => void>();

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function publish() {
  for (const listener of listeners) listener();
}

export function currentDraft(id: string): DocumentDraft | null {
  return drafts.get(id) ?? null;
}

/**
 * Applies an edit to the kit's draft, starting one from `opened` when the kit
 * has none; an existing draft keeps its own base. A draft edited back to its
 * base ends, so a draft always has something to save.
 */
export function editDraft(opened: DesignSystemDocumentView, change: DraftChange): void {
  const next = applyDraftChange(drafts.get(opened.id) ?? draftOf(opened), change);
  if (changeCount(next) === 0) drafts.delete(opened.id);
  else drafts.set(opened.id, next);
  publish();
}

export function discardDraft(id: string): void {
  if (drafts.delete(id)) publish();
}

export function useDocumentDraft(id: string): DocumentDraft | null {
  return useSyncExternalStore(subscribe, () => currentDraft(id));
}

function mapItems(sections: DocumentSection[], map: (item: DocumentItem) => DocumentItem) {
  return sections.map((section) => withItems(section, section.items.map(map)));
}

function mapGroups(sections: DocumentSection[], map: (group: TokenGroup) => TokenGroup) {
  return mapItems(sections, (item) => (item.kind === 'group' ? map(item) : item));
}

function insertSection(sections: DocumentSection[], section: DocumentSection): DocumentSection[] {
  const rank = SECTION_ORDER.indexOf(section.kind);
  const at = sections.findIndex((existing) => SECTION_ORDER.indexOf(existing.kind) > rank);
  if (at === -1) return [...sections, section];
  return [...sections.slice(0, at), section, ...sections.slice(at)];
}

function swapped<T>(list: readonly T[], index: number, by: -1 | 1): T[] {
  const to = index + by;
  if (index < 0 || to < 0 || to >= list.length) return [...list];
  const next = [...list];
  [next[index], next[to]] = [next[to], next[index]];
  return next;
}

function moved(sections: DocumentSection[], key: string, by: -1 | 1): DocumentSection[] {
  const index = sections.findIndex((section) => section.id === key);
  if (index >= 0) return swapped(sections, index, by);
  return sections.map((section) => {
    const at = section.items.findIndex((item) => item.id === key);
    return at < 0 ? section : withItems(section, swapped<DocumentItem>(section.items, at, by));
  });
}

function removed(sections: DocumentSection[], key: string): DocumentSection[] {
  const name = tokenNameOf(key);
  if (name !== null)
    return mapGroups(sections, (group) => ({
      ...group,
      tokens: group.tokens.filter((token) => token.name !== name),
    }));
  return sections
    .filter((section) => section.id !== key)
    .map((section) =>
      withItems(
        section,
        section.items.filter((item) => item.id !== key),
      ),
    );
}

// Undo puts the base's copy back after the nearest earlier neighbour that is
// still there. Nothing comes back over something that now holds its place.
function restored(
  base: DocumentSection[],
  next: DocumentSection[],
  key: string,
): DocumentSection[] {
  const name = tokenNameOf(key);
  if (name !== null) {
    const holder = tokensByName(base).get(name)?.holder;
    const baseGroup = holder === undefined ? undefined : itemsById(base).get(holder)?.item;
    if (baseGroup?.kind !== 'group' || tokensByName(next).has(name)) return next;
    const tokenName = (token: DocumentToken) => token.name;
    return mapGroups(next, (group) =>
      group.id === baseGroup.id
        ? { ...group, tokens: restoredInto(baseGroup.tokens, group.tokens, name, tokenName) }
        : group,
    );
  }
  const baseSection = base.find((section) => section.id === key);
  if (baseSection) {
    const taken = next.some(
      (section) =>
        section.id === key || (section.kind !== 'notes' && section.kind === baseSection.kind),
    );
    return taken ? next : restoredInto(base, next, key, (section) => section.id);
  }
  const home = base.find((section) => section.items.some((item) => item.id === key));
  if (!home || itemsById(next).has(key)) return next;
  return next.map((section) =>
    section.id === home.id
      ? withItems(
          section,
          restoredInto<DocumentItem>(home.items, section.items, key, (item) => item.id),
        )
      : section,
  );
}

function restoredInto<T>(
  base: readonly T[],
  next: readonly T[],
  key: string,
  keyOf: (element: T) => string,
): T[] {
  const index = base.findIndex((element) => keyOf(element) === key);
  let at = 0;
  for (let earlier = index - 1; earlier >= 0; earlier -= 1) {
    const found = next.findIndex((element) => keyOf(element) === keyOf(base[earlier]));
    if (found >= 0) {
      at = found + 1;
      break;
    }
  }
  return [...next.slice(0, at), base[index], ...next.slice(at)];
}

function takenKeys(draft: DocumentDraft) {
  const ids = new Set<string>();
  const labels = new Set<string>();
  const assetNames = new Set<string>();
  for (const section of [...draft.base.sections, ...draft.sections]) {
    ids.add(section.id);
    for (const item of section.items) {
      ids.add(item.id);
      if (item.kind === 'note') labels.add(item.label);
      if (item.kind === 'asset') assetNames.add(item.name);
    }
  }
  return { ids, labels, assetNames };
}

function idStem(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 40);
}

function freshId(stem: string, taken: ReadonlySet<string>): string {
  if (!taken.has(stem)) return stem;
  let n = 2;
  while (taken.has(`${stem}-${String(n)}`)) n += 1;
  return `${stem}-${String(n)}`;
}

export function sameCover(a: DesignSystemCover, b: DesignSystemCover): boolean {
  if (a === null || b === null) return a === b;
  if (a.kind === 'preview') return b.kind === 'preview' && a.example === b.example;
  return b.kind === 'image' && a.assetId === b.assetId;
}
