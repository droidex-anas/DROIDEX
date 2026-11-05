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

// A reference to a kit token reads and is typed as {accent}, or {accent, red}
// with a fallback. A token value cannot hold a brace, so the form is never CSS.
const KIT_VAR_REFERENCE = /^\s*--ds-([a-z0-9]+(?:-[a-z0-9]+)*)\s*(?:,([\s\S]*))?$/;
const VAR_REFERENCE = /^\s*(--[a-z0-9]+(?:-[a-z0-9]+)*)\s*(?:,([\s\S]*))?$/;
const BRACE_REFERENCE = /^\s*([a-z0-9]+(?:-[a-z0-9]+)*)\s*(?:,([\s\S]*))?$/;
const CLOSING_BRACKET: Record<string, string> = { '(': ')', '{': '}' };

interface TokenReference {
  /** Where the reference starts in its value, and where it ends past its closing bracket. */
  start: number;
  end: number;
  name: string;
  /** What CSS uses where the token is not set, or null without one. */
  fallback: string | null;
}

/** What the document shows of a value: `var(--ds-accent)` is `{accent}`, `var(--ds-accent, red)` is `{accent, red}`. */
export function displayTokenValue(value: string): string {
  return rewriteReferences(value, 'var(', KIT_VAR_REFERENCE, ({ name, fallback }) =>
    fallback === null ? `{${name}}` : `{${name}, ${displayTokenValue(fallback)}}`,
  );
}

/** The CSS a value typed as the document shows it stands for: `{accent}` is `var(--ds-accent)`. */
export function cssTokenValue(text: string): string {
  return rewriteReferences(text, '{', BRACE_REFERENCE, ({ name, fallback }) => {
    const token = KIT_TOKEN_PREFIX + name;
    return fallback === null ? `var(${token})` : `var(${token}, ${cssTokenValue(fallback)})`;
  });
}

/** Why the token `name` cannot hold the CSS `value` as far as references go, or null. */
export function selfReferenceProblem(name: string, value: string): string | null {
  return refersTo(value, name) ? `${bareTokenName(name)} cannot refer to itself.` : null;
}

function refersTo(value: string, name: string): boolean {
  return findReferences(value, 'var(', VAR_REFERENCE).some(
    (reference) =>
      reference.name === name ||
      (reference.fallback !== null && refersTo(reference.fallback, name)),
  );
}

function rewriteReferences(
  text: string,
  opener: 'var(' | '{',
  inner: RegExp,
  write: (reference: TokenReference) => string,
): string {
  let rewritten = '';
  let copiedTo = 0;
  for (const reference of findReferences(text, opener, inner)) {
    rewritten += text.slice(copiedTo, reference.start) + write(reference);
    copiedTo = reference.end;
  }
  return rewritten + text.slice(copiedTo);
}

// Each reference from `opener` to its balanced closing bracket whose inside
// `inner` reads. As in CSS, `var(` matches in any case and a quoted string
// holds no references or brackets.
function findReferences(text: string, opener: 'var(' | '{', inner: RegExp): TokenReference[] {
  const references: TokenReference[] = [];
  let index = 0;
  while (index < text.length) {
    if (isQuote(text[index])) {
      index = quoteEnd(text, index) + 1;
      continue;
    }
    const contentStart = index + opener.length;
    const isOpener = text.slice(index, contentStart).toLowerCase() === opener;
    const end = isOpener ? closingBracket(text, contentStart - 1) : -1;
    const match = isOpener ? inner.exec(text.slice(contentStart, end)) : null;
    if (!match) {
      index += 1;
      continue;
    }
    const fallback = match.at(2)?.trim() ?? null;
    references.push({ start: index, end: end + 1, name: match[1], fallback });
    index = end + 1;
  }
  return references;
}

/** Where the bracket at `open` closes, counting the same brackets outside quoted strings; an unclosed one closes at the end, as in CSS. */
function closingBracket(text: string, open: number): number {
  const opening = text[open];
  const closing = CLOSING_BRACKET[opening];
  let depth = 0;
  for (let index = open; index < text.length; index += 1) {
    if (isQuote(text[index])) index = quoteEnd(text, index);
    else if (text[index] === opening) depth += 1;
    else if (text[index] === closing) depth -= 1;
    if (depth === 0) return index;
  }
  return text.length;
}

function isQuote(char: string): boolean {
  return char === '"' || char === "'";
}

/** Where the string quoted at `open` closes, past backslash escapes; an unclosed one runs to the end, as in CSS. */
function quoteEnd(text: string, open: number): number {
  for (let index = open + 1; index < text.length; index += 1) {
    if (text[index] === '\\') index += 1;
    else if (text[index] === text[open]) return index;
  }
  return text.length;
}

/** What a note's label reads as: "1-rules.md" is "Rules", "design-engineering.md" "Design engineering". */
export function noteTitle(label: string): string {
  const stem = label.replace(/\.md$/, '');
  const words = stem.replace(/^\d+-/, '').replaceAll('-', ' ').trim() || stem;
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/** The label a typed note title writes to: "My rules" is "my-rules.md". */
export function noteLabel(title: string): string {
  const slug = title
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return `${slug}.md`;
}

/** The names a new or renamed token, note, preview or asset may not take. */
export function documentNames(sections: DocumentSection[]) {
  const tokenNames = new Set<string>();
  const noteLabels = new Set<string>();
  const previewTitles = new Set<string>();
  const assetNames = new Set<string>();
  for (const section of sections)
    for (const item of section.items) {
      if (item.kind === 'group') for (const token of item.tokens) tokenNames.add(token.name);
      if (item.kind === 'note') noteLabels.add(item.label);
      if (item.kind === 'preview') previewTitles.add(item.title);
      if (item.kind === 'asset') assetNames.add(item.name);
    }
  return { tokenNames, noteLabels, previewTitles, assetNames };
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

// What a change summary counts, in the order it lists them.
const COUNTED_NOUNS = ['token', 'note', 'preview', 'image', 'group', 'section'] as const;
const COUNTED_MARKS: DraftMark[] = ['added', 'changed', 'removed'];
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
 * lists it: the name and cover, then what was added, changed or removed,
 * counted by kind ("Cover replaced, 3 tokens changed, note added").
 */
export function changeSummary(base: SummarizedVersion, next: SummarizedVersion): string {
  const items = new Map([...itemsById(base.sections), ...itemsById(next.sections)]);
  const counts = new Map<string, number>();
  const nounOf = (key: string) => {
    if (tokenNameOf(key) !== null) return 'token';
    const item = items.get(key)?.item;
    return item ? ITEM_NOUNS[item.kind] : 'section';
  };
  for (const [key, mark] of draftDiff(base.sections, next.sections)) {
    const counted = `${nounOf(key)} ${mark}`;
    counts.set(counted, (counts.get(counted) ?? 0) + 1);
  }
  const parts: string[] = [];
  if (base.name !== next.name) parts.push('renamed');
  const cover = coverChange(base.cover, next.cover);
  if (cover !== null) parts.push(cover);
  for (const noun of COUNTED_NOUNS)
    for (const mark of COUNTED_MARKS) {
      const count = counts.get(`${noun} ${mark}`);
      if (count === 1) parts.push(`${noun} ${mark}`);
      else if (count !== undefined) parts.push(`${String(count)} ${noun}s ${mark}`);
    }
  if (parts.length === 0) return 'No changes';
  const line = parts.join(', ');
  return line.charAt(0).toUpperCase() + line.slice(1);
}

function coverChange(base: DesignSystemCover, next: DesignSystemCover): string | null {
  if (JSON.stringify(base) === JSON.stringify(next)) return null;
  if (base === null) return 'cover added';
  return next === null ? 'cover removed' : 'cover replaced';
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
