// An agent's changes to a design system document (design system documents spec
// §11). A change names its item by the document's natural key: a token by its
// name, a note by its label, a preview by its title and an image by its name;
// the sidecar assigns every id. A new token goes into the group and token
// section its change names. Any other new item goes into the section its change
// names, or else the first section of its kind, which is created at its
// canonical place when the document has none.

import { z } from 'zod';
import { SECTION_TITLES, uniqueId } from './buildDocument.js';
import { canvasError, type CanvasCommandError } from './canvasError.js';
import {
  CANONICAL_SECTION_ORDER,
  DOCUMENT_LIMITS,
  insertSection,
  TOKEN_KINDS,
  tokenNameSchema,
  tokenValueSchema,
  type DocumentSection,
} from './designSystemDocument.js';
import { sourcePathSchema } from './schema.js';

const titleSchema = z.string().trim().min(1).max(DOCUMENT_LIMITS.maxTitleLength);
const noteSchema = z.string().optional().describe('A short usage note; an empty note removes it.');
const sectionSchema = z
  .string()
  .optional()
  .describe('A section id from canvas_theme read, or a section kind such as components.');

const changeSchema = z.union([
  z
    .object({
      set: z.literal('token'),
      name: tokenNameSchema,
      value: tokenValueSchema.optional(),
      light: tokenValueSchema.optional(),
      dark: tokenValueSchema.optional(),
      note: noteSchema,
      section: z.enum(TOKEN_KINDS).optional(),
      group: titleSchema.optional().describe('The title of the token group, such as Accent.'),
    })
    .strict(),
  z
    .object({ set: z.literal('note'), label: z.string(), body: z.string(), section: sectionSchema })
    .strict(),
  z
    .object({
      set: z.literal('preview'),
      title: titleSchema,
      example: sourcePathSchema,
      width: z.number().int(),
      height: z.number().int(),
      note: noteSchema,
      section: sectionSchema,
    })
    .strict(),
  z
    .object({
      set: z.literal('asset'),
      name: titleSchema,
      assetId: z.string().regex(/^[0-9a-f]{64}$/),
      note: noteSchema,
    })
    .strict(),
  z
    .object({ remove: z.enum(['token', 'note', 'preview', 'asset']), key: z.string().min(1) })
    .strict(),
]);

export const documentChangesSchema = z
  .array(changeSchema)
  .max(200, 'A save carries at most 200 changes. Split the rest into another save.');

export type DocumentChange = z.infer<typeof changeSchema>;

type SectionKind = DocumentSection['kind'];
type TokenKind = (typeof TOKEN_KINDS)[number];
type TokenSection = Extract<DocumentSection, { kind: TokenKind }>;
type DocumentItem = DocumentSection['items'][number];
type Group = Extract<DocumentItem, { kind: 'group' }>;
type Token = Group['tokens'][number];
type KeyedKind = 'note' | 'preview' | 'asset';
type Keyed<Kind extends KeyedKind> = Extract<DocumentItem, { kind: Kind }>;
type TokenChange = Extract<DocumentChange, { set: 'token' }>;

interface Found<Item> {
  section: DocumentSection;
  index: number;
  item: Item;
}

// The two preview targets of §14, which no item may take.
const RESERVED_IDS = ['cover', 'typography'];
const PREVIEW_KINDS: readonly SectionKind[] = ['components', 'notes'];

/** The document after every change in order; the caller validates the version it makes. */
export function applyDocumentChanges(
  sections: DocumentSection[],
  changes: DocumentChange[],
): DocumentSection[] {
  const edit = new DocumentEdit(sections);
  for (const change of changes) edit.apply(change);
  return edit.sections;
}

class DocumentEdit {
  sections: DocumentSection[];
  private readonly ids = new Set(RESERVED_IDS);
  /** Images the user already put in this kit; an agent cannot bring new bytes (§8). */
  private readonly assetIds = new Set<string>();

  constructor(base: DocumentSection[]) {
    this.sections = structuredClone(base);
    for (const section of this.sections) {
      this.ids.add(section.id);
      for (const item of section.items) {
        this.ids.add(item.id);
        if (item.kind === 'asset') this.assetIds.add(item.assetId);
      }
    }
  }

  apply(change: DocumentChange): void {
    if ('remove' in change) {
      this.remove(change.remove, change.key);
      return;
    }
    switch (change.set) {
      case 'token':
        this.setToken(change);
        return;
      case 'note': {
        const found = this.find('note', change.label);
        const note: Keyed<'note'> = found
          ? { ...found.item, body: change.body }
          : {
              kind: 'note',
              id: uniqueId(this.ids, `${change.label.replace(/\.md$/, '')}-note`),
              label: change.label,
              body: change.body,
              author: 'agent',
            };
        this.put(note, found, change.section, CANONICAL_SECTION_ORDER, 'note');
        return;
      }
      case 'preview': {
        const { title, example, width, height } = change;
        const found = this.find('preview', title);
        const preview: Keyed<'preview'> = found
          ? { ...found.item, example, width, height }
          : { kind: 'preview', id: uniqueId(this.ids, title), title, example, width, height };
        this.put(withNote(preview, change.note), found, change.section, PREVIEW_KINDS, 'preview');
        return;
      }
      case 'asset': {
        const { name, assetId } = change;
        if (!this.assetIds.has(assetId))
          throw refusal(`Only images the user added can be used, and ${name} names another one.`);
        const found = this.find('asset', name);
        const asset: Keyed<'asset'> = found
          ? { ...found.item, assetId }
          : { kind: 'asset', id: uniqueId(this.ids, name), name, assetId };
        this.put(withNote(asset, change.note), found, undefined, ['assets'], 'image');
        return;
      }
    }
  }

  private setToken(change: TokenChange): void {
    const found = this.findToken(change.name);
    const token = changedToken(found?.item, change);
    if (!found) {
      if (!change.section || !change.group)
        throw refusal(`${change.name} is new, so name its section and group.`);
      this.group(change.section, change.group).tokens.push(token);
      return;
    }
    const section = change.section ?? found.section.kind;
    const title = change.group ?? found.group.title;
    if (section === found.section.kind && title === found.group.title) {
      found.group.tokens[found.index] = token;
      return;
    }
    this.takeToken(found);
    this.group(section, title).tokens.push(token);
  }

  private remove(kind: 'token' | KeyedKind, key: string): void {
    const found = kind === 'token' ? this.findToken(key) : this.find(kind, key);
    if (!found) throw refusal(`There is no ${kind} ${key} to remove.`);
    if ('group' in found) this.takeToken(found);
    else found.section.items.splice(found.index, 1);
  }

  /** Puts an item where it is, in the section `section` names, or at the end of its kind's first. */
  private put(
    item: Keyed<KeyedKind>,
    found: Found<DocumentItem> | null,
    section: string | undefined,
    kinds: readonly SectionKind[],
    what: string,
  ): void {
    const target =
      found && section === undefined ? found.section : this.target(section, kinds, what);
    if (found?.section === target) {
      target.items[found.index] = item;
      return;
    }
    if (found) found.section.items.splice(found.index, 1);
    // `kinds` lists only sections that hold this item, and the version is validated after.
    (target.items as DocumentItem[]).push(item);
  }

  private target(
    wanted: string | undefined,
    kinds: readonly SectionKind[],
    what: string,
  ): DocumentSection {
    if (wanted === undefined) return this.sectionOf(kinds[0]);
    const named = this.sections.find((section) => section.id === wanted);
    if (named) {
      if (kinds.includes(named.kind)) return named;
      throw refusal(`A ${what} cannot go in the ${named.title} section.`);
    }
    const kind = kinds.find((candidate) => candidate === wanted);
    if (kind) return this.sectionOf(kind);
    throw refusal(
      `There is no section ${wanted}. Name a section id from canvas_theme read, or one of ${kinds.join(', ')}.`,
    );
  }

  private sectionOf(kind: SectionKind): DocumentSection {
    const existing = this.sections.find((section) => section.kind === kind);
    if (existing) return existing;
    const id = uniqueId(this.ids, kind === 'notes' ? 'overview' : kind);
    // An empty section of any kind is valid; TypeScript cannot pair a variable kind with its items.
    const created = { kind, id, title: SECTION_TITLES[kind], items: [] } as DocumentSection;
    this.sections = insertSection(this.sections, created);
    return created;
  }

  private group(kind: TokenKind, title: string): Group {
    const section = this.sectionOf(kind) as TokenSection;
    const existing = section.items.find(
      (item): item is Group => item.kind === 'group' && item.title === title,
    );
    if (existing) return existing;
    const group: Group = { kind: 'group', id: uniqueId(this.ids, title), title, tokens: [] };
    section.items.push(group);
    return group;
  }

  private find<Kind extends KeyedKind>(kind: Kind, key: string): Found<Keyed<Kind>> | null {
    for (const section of this.sections) {
      const index = section.items.findIndex((item) => item.kind === kind && keyOf(item) === key);
      if (index >= 0) return { section, index, item: section.items[index] as Keyed<Kind> };
    }
    return null;
  }

  private findToken(name: string): (Found<Token> & { section: TokenSection; group: Group }) | null {
    for (const section of this.sections) {
      if (section.kind === 'notes' || section.kind === 'components' || section.kind === 'assets')
        continue;
      for (const group of section.items) {
        if (group.kind !== 'group') continue;
        const index = group.tokens.findIndex((token) => token.name === name);
        if (index >= 0) return { section, group, index, item: group.tokens[index] };
      }
    }
    return null;
  }

  /** Takes a token out of its group, and the group out of its section once it is empty. */
  private takeToken({
    section,
    group,
    index,
  }: {
    section: TokenSection;
    group: Group;
    index: number;
  }) {
    group.tokens.splice(index, 1);
    if (group.tokens.length > 0) return;
    section.items.splice(section.items.indexOf(group), 1);
  }
}

function changedToken(previous: Token | undefined, change: TokenChange): Token {
  const { name } = change;
  const kept = previous?.note === undefined ? { name } : { name, note: previous.note };
  return withNote({ ...kept, ...changedValues(previous, change) }, change.note);
}

/** One value for both modes, or one per mode; a change that names neither keeps the values. */
function changedValues(
  previous: Token | undefined,
  change: TokenChange,
): { value: string } | { light: string; dark: string } {
  const { name, value, light, dark } = change;
  const perMode = light !== undefined || dark !== undefined;
  if (value !== undefined && perMode)
    throw refusal(`Give ${name} either value, or light and dark.`);
  if (value !== undefined) return { value };
  if (perMode) return modeValues(previous, change);
  if (!previous) throw refusal(`${name} is new, so give it a value, or light and dark.`);
  return 'value' in previous
    ? { value: previous.value }
    : { light: previous.light, dark: previous.dark };
}

/** A mode the change leaves out keeps the value it had. */
function modeValues(
  previous: Token | undefined,
  { name, light, dark }: TokenChange,
): { light: string; dark: string } {
  const before =
    previous && ('value' in previous ? { light: previous.value, dark: previous.value } : previous);
  const nextLight = light ?? before?.light;
  const nextDark = dark ?? before?.dark;
  if (nextLight === undefined || nextDark === undefined)
    throw refusal(`${name} is new, so give it both light and dark.`);
  return { light: nextLight, dark: nextDark };
}

/** `note` replaces the item's note; an empty one removes it and none keeps it. */
function withNote<Item extends { note?: string }>(item: Item, note: string | undefined): Item {
  if (note === undefined) return item;
  const next = { ...item, note };
  // Every item that takes a note has it optional; the constraint cannot say so.
  if (note === '') delete (next as { note?: string }).note;
  return next;
}

function keyOf(item: DocumentItem): string | undefined {
  switch (item.kind) {
    case 'note':
      return item.label;
    case 'preview':
      return item.title;
    case 'asset':
      return item.name;
    default:
      return undefined;
  }
}

function refusal(message: string): CanvasCommandError {
  return canvasError('invalid_input', message);
}
