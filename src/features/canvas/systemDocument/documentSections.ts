// A document's sections compared by key (spec §6): what one list changes
// against another, and what was removed put back in place to show struck
// through. A draft is compared with its base; slice 2b compares a proposal.

import type { DocumentSection, DocumentToken } from '../designSystemDocumentProtocol';
import { isTokenName, isTokenValue } from '../designSystemDocumentValidation';
import type { PreviewMode } from '../PreviewModeToggle';
import type { DesignSystemCover } from '../protocol';
import { modeValue } from './specimenStyle';

export type DocumentItem = DocumentSection['items'][number];
export type SectionKind = DocumentSection['kind'];
export type DraftMark = 'added' | 'changed' | 'removed';

// Ids never contain a colon, so a token key cannot name a section or item.
const TOKEN_KEY_PREFIX = 'token:';

/** The key a token is marked and changed by; sections and items use their id. */
export function tokenKey(name: string): string {
  return TOKEN_KEY_PREFIX + name;
}

export function tokenNameOf(key: string): string | null {
  return key.startsWith(TOKEN_KEY_PREFIX) ? key.slice(TOKEN_KEY_PREFIX.length) : null;
}

// Callers keep every item in a section of a kind that holds it.
export function withItems(section: DocumentSection, items: DocumentItem[]): DocumentSection {
  return { ...section, items } as DocumentSection;
}

export function itemsById(sections: DocumentSection[]) {
  const items = new Map<string, { item: DocumentItem; holder: string }>();
  for (const section of sections)
    for (const item of section.items) items.set(item.id, { item, holder: section.id });
  return items;
}

export function tokensByName(sections: DocumentSection[]) {
  const tokens = new Map<string, { token: DocumentToken; holder: string }>();
  for (const section of sections)
    for (const item of section.items)
      if (item.kind === 'group')
        for (const token of item.tokens) tokens.set(token.name, { token, holder: item.id });
  return tokens;
}

/**
 * The draft's token values in `mode` that differ from the base's, by name, as
 * live previews show them. A value a save would refuse stays at the base's.
 */
export function changedTokenValues(
  base: DocumentSection[],
  draft: DocumentSection[],
  mode: PreviewMode,
): Record<string, string> {
  const saved = tokensByName(base);
  const changed: Record<string, string> = {};
  for (const [name, { token }] of tokensByName(draft)) {
    const value = modeValue(token, mode).trim();
    const before = saved.get(name);
    if (before && modeValue(before.token, mode).trim() === value) continue;
    if (isTokenName(name) && isTokenValue(value)) changed[name] = value;
  }
  return changed;
}

// A kit's tokens share the --ds- namespace beside Tailwind's and the app's own.
const KIT_TOKEN_PREFIX = '--ds-';

/** What the document calls a token: `--ds-accent` is "accent"; a name outside the kit's namespace reads whole. */
export function bareTokenName(name: string): string {
  return name.startsWith(KIT_TOKEN_PREFIX) ? name.slice(KIT_TOKEN_PREFIX.length) : name;
}

/** The token a typed bare name stands for: "accent" is `--ds-accent`; a name typed with its dashes stays as typed. */
export function fullTokenName(bare: string): string {
  return bare.startsWith('--') ? bare : KIT_TOKEN_PREFIX + bare;
}

/** What a note's label reads as: "1-rules.md" is "Rules", "design-engineering.md" "Design engineering". */
export function noteTitle(label: string): string {
  const stem = label.replace(/\.md$/, '');
  const words = stem.replace(/^\d+-/, '').replaceAll('-', ' ').trim() || stem;
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/** The names a new or renamed token, note or preview may not take. */
export function documentNames(sections: DocumentSection[]) {
  const tokenNames = new Set<string>();
  const noteLabels = new Set<string>();
  const previewTitles = new Set<string>();
  for (const section of sections)
    for (const item of section.items) {
      if (item.kind === 'group') for (const token of item.tokens) tokenNames.add(token.name);
      if (item.kind === 'note') noteLabels.add(item.label);
      if (item.kind === 'preview') previewTitles.add(item.title);
    }
  return { tokenNames, noteLabels, previewTitles };
}

/**
 * What `next` changes against `base`. A removed section or group is one mark:
 * what it held is not marked again. A section is changed when it is renamed,
 * moved, or its items reordered, a group when its tokens are reordered, and an
 * item or token when it moves to another section or group.
 */
export function draftDiff(
  base: DocumentSection[],
  next: DocumentSection[],
): Map<string, DraftMark> {
  const marks = new Map<string, DraftMark>();
  markSections(base, next, marks);
  const nextItems = itemsById(next);
  markItems(itemsById(base), nextItems, new Set(next.map(({ id }) => id)), marks);
  markTokens(tokensByName(base), tokensByName(next), nextItems, marks);
  return marks;
}

function markSections(
  base: DocumentSection[],
  next: DocumentSection[],
  marks: Map<string, DraftMark>,
) {
  const baseSections = new Map(base.map((section) => [section.id, section]));
  const nextIds = new Set(next.map(({ id }) => id));
  const baseOrder = base.filter(({ id }) => nextIds.has(id)).map(({ id }) => id);
  const nextOrder = next.filter(({ id }) => baseSections.has(id)).map(({ id }) => id);
  for (const section of next) {
    const was = baseSections.get(section.id);
    if (!was) marks.set(section.id, 'added');
    else if (
      was.title !== section.title ||
      baseOrder.indexOf(section.id) !== nextOrder.indexOf(section.id) ||
      !sameOrder(
        was.items.map(({ id }) => id),
        section.items.map(({ id }) => id),
      )
    )
      marks.set(section.id, 'changed');
  }
  for (const { id } of base) if (!nextIds.has(id)) marks.set(id, 'removed');
}

function markItems(
  baseItems: ReturnType<typeof itemsById>,
  nextItems: ReturnType<typeof itemsById>,
  nextSectionIds: ReadonlySet<string>,
  marks: Map<string, DraftMark>,
) {
  for (const [id, { item, holder }] of nextItems) {
    const was = baseItems.get(id);
    if (!was) marks.set(id, 'added');
    else if (was.holder !== holder || !sameItem(was.item, item)) marks.set(id, 'changed');
  }
  for (const [id, { holder }] of baseItems)
    if (!nextItems.has(id) && nextSectionIds.has(holder)) marks.set(id, 'removed');
}

function markTokens(
  baseTokens: ReturnType<typeof tokensByName>,
  nextTokens: ReturnType<typeof tokensByName>,
  nextItems: ReturnType<typeof itemsById>,
  marks: Map<string, DraftMark>,
) {
  for (const [name, { token, holder }] of nextTokens) {
    const was = baseTokens.get(name);
    if (!was) marks.set(tokenKey(name), 'added');
    else if (was.holder !== holder || !sameToken(was.token, token))
      marks.set(tokenKey(name), 'changed');
  }
  for (const [name, { holder }] of baseTokens)
    if (!nextTokens.has(name) && nextItems.has(holder)) marks.set(tokenKey(name), 'removed');
}

const MAX_NAMED_TOKENS = 3;
// What a change summary counts rather than names, in the order it lists them.
const COUNTED_NOUNS = ['note', 'preview', 'image', 'group', 'section'] as const;
const ITEM_NOUNS: Record<DocumentItem['kind'], (typeof COUNTED_NOUNS)[number]> = {
  note: 'note',
  preview: 'preview',
  asset: 'image',
  group: 'group',
};

interface SummarizedVersion {
  name: string;
  cover: DesignSystemCover;
  sections: DocumentSection[];
}

/**
 * One line for what `next` changes against `base`, as the version history
 * lists it: a few tokens by bare name and everything else counted
 * ("Accent, radius-card, 1 note").
 */
export function changeSummary(base: SummarizedVersion, next: SummarizedVersion): string {
  const items = new Map([...itemsById(base.sections), ...itemsById(next.sections)]);
  const tokens: string[] = [];
  const counts = new Map<string, number>();
  for (const key of draftDiff(base.sections, next.sections).keys()) {
    const token = tokenNameOf(key);
    if (token !== null) {
      tokens.push(bareTokenName(token));
      continue;
    }
    const item = items.get(key)?.item;
    const noun = item ? ITEM_NOUNS[item.kind] : 'section';
    counts.set(noun, (counts.get(noun) ?? 0) + 1);
  }
  const parts: string[] = [];
  if (base.name !== next.name) parts.push('name');
  if (JSON.stringify(base.cover) !== JSON.stringify(next.cover)) parts.push('cover');
  if (tokens.length > MAX_NAMED_TOKENS) parts.push(counted(tokens.length, 'token'));
  else parts.push(...tokens);
  for (const noun of COUNTED_NOUNS) {
    const count = counts.get(noun);
    if (count !== undefined) parts.push(counted(count, noun));
  }
  if (parts.length === 0) return 'No changes';
  const line = parts.join(', ');
  return line.charAt(0).toUpperCase() + line.slice(1);
}

function counted(count: number, noun: string): string {
  return `${String(count)} ${noun}${count === 1 ? '' : 's'}`;
}

/** Whether the section, or anything in it, has a mark. */
export function isMarked(section: DocumentSection, marks: ReadonlyMap<string, DraftMark>): boolean {
  if (marks.has(section.id)) return true;
  return section.items.some(
    (item) =>
      marks.has(item.id) ||
      (item.kind === 'group' && item.tokens.some((token) => marks.has(tokenKey(token.name)))),
  );
}

/** `next` with what `marks` calls removed put back where `base` had it. */
export function withRemoved(
  base: DocumentSection[],
  next: DocumentSection[],
  marks: ReadonlyMap<string, DraftMark>,
): DocumentSection[] {
  const isRemoved = (key: string) => marks.get(key) === 'removed';
  const byId = ({ id }: { id: string }) => id;
  const byKey = (token: DocumentToken) => tokenKey(token.name);
  const baseSections = new Map(base.map((section) => [section.id, section]));
  const shown = next.map((section) => {
    const was = baseSections.get(section.id);
    if (!was) return section;
    const items = section.items.map((item) => {
      const wasGroup = was.items.find((candidate) => candidate.id === item.id);
      if (item.kind !== 'group' || wasGroup?.kind !== 'group') return item;
      return { ...item, tokens: mergeRemoved(wasGroup.tokens, item.tokens, byKey, isRemoved) };
    });
    return withItems(section, mergeRemoved(was.items, items, byId, isRemoved));
  });
  return mergeRemoved(base, shown, byId, isRemoved);
}

// Each removed base element goes after the base element before it, so it shows
// where it was.
function mergeRemoved<T>(
  base: readonly T[],
  next: readonly T[],
  keyOf: (element: T) => string,
  isRemoved: (key: string) => boolean,
): T[] {
  const result = [...next];
  let at = 0;
  for (const element of base) {
    const key = keyOf(element);
    if (isRemoved(key)) {
      result.splice(at, 0, element);
      at += 1;
      continue;
    }
    const found = result.findIndex((candidate) => keyOf(candidate) === key);
    if (found >= 0) at = found + 1;
  }
  return result;
}

function sameOrder(base: string[], next: string[]): boolean {
  const kept = new Set(next);
  const baseKept = base.filter((id) => kept.has(id));
  const was = new Set(base);
  const nextKept = next.filter((id) => was.has(id));
  return baseKept.every((id, index) => nextKept[index] === id);
}

function sameItem(a: DocumentItem, b: DocumentItem): boolean {
  switch (a.kind) {
    case 'note':
      return b.kind === 'note' && a.label === b.label && a.body === b.body;
    case 'group':
      return (
        b.kind === 'group' &&
        a.title === b.title &&
        sameOrder(
          a.tokens.map(({ name }) => name),
          b.tokens.map(({ name }) => name),
        )
      );
    case 'preview':
      return (
        b.kind === 'preview' &&
        a.title === b.title &&
        a.note === b.note &&
        a.example === b.example &&
        a.width === b.width &&
        a.height === b.height
      );
    case 'asset':
      return (
        b.kind === 'asset' && a.name === b.name && a.note === b.note && a.assetId === b.assetId
      );
  }
}

function sameToken(a: DocumentToken, b: DocumentToken): boolean {
  if (a.note !== b.note) return false;
  if ('value' in a) return 'value' in b && a.value === b.value;
  return !('value' in b) && a.light === b.light && a.dark === b.dark;
}
