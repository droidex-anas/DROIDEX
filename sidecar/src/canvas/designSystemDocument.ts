// A design system version as a document the user reads and edits (design system
// documents spec §2): ordered sections of notes, token groups, previews and
// assets. The kit's light and dark tokens and the text its agent reads are
// derived from the sections, never stored beside them. The renderer mirrors
// these types by hand in src/features/canvas/designSystemDocumentProtocol.ts.

import { z } from 'zod';
import { sourcePathSchema } from './schema.js';

export const DOCUMENT_LIMITS = {
  maxSections: 16,
  maxItemsPerSection: 64,
  maxTitleLength: 120,
  maxTokens: 128,
  maxTokenValueLength: 160,
  maxTokenNoteBytes: 400,
  maxNoteBytes: 8 * 1024,
  maxItemNoteBytes: 1024,
  maxPreviews: 24,
  maxAssets: 48,
  previewWidthPx: { min: 240, max: 1440 },
  previewHeightPx: { min: 120, max: 1200 },
  maxExampleBytes: 64 * 1024,
  maxExamplesBytes: 512 * 1024,
  /** The stored version without its files and examples. */
  maxDocumentBytes: 256 * 1024,
} as const;

// §14 asks for these as preview targets beside the previews' own ids.
const RESERVED_PREVIEW_IDS = new Set(['cover', 'typography']);

const TOKEN_KINDS = [
  'colors',
  'typography',
  'spacing',
  'radius',
  'shadows',
  'motion',
  'tokens',
] as const;

/** Where a builder puts each kind of section, and where one added later goes. */
export const CANONICAL_SECTION_ORDER = ['notes', ...TOKEN_KINDS, 'components', 'assets'] as const;

const TOKEN_NAME_MESSAGE =
  'A design token is a CSS custom property such as --ds-accent: lowercase words separated by hyphens.';
const TOKEN_VALUE_MESSAGE =
  'A design token value is a single CSS value without a semicolon, brace or comment.';
const ID_MESSAGE = 'A section or item id is 1 to 48 lowercase letters, digits or hyphens.';
const LABEL_MESSAGE =
  'A note label is a lowercase file name ending in .md, such as 1-rules.md, of at most 48 characters.';

export const tokenNameSchema = z.string().regex(/^--[a-z0-9]+(-[a-z0-9]+)*$/, TOKEN_NAME_MESSAGE);

// A token value is pasted into a stylesheet, so it may not close the rule it
// sits in or open a comment.
export const tokenValueSchema = z
  .string()
  .trim()
  .min(1, TOKEN_VALUE_MESSAGE)
  .max(DOCUMENT_LIMITS.maxTokenValueLength, TOKEN_VALUE_MESSAGE)
  .refine((value) => !/[;{}<>]|\/\*/.test(value) && !/[\n\r\t]/.test(value), {
    message: TOKEN_VALUE_MESSAGE,
  });

function textOfAtMost(maxBytes: number, what: string) {
  return z.string().refine((text) => Buffer.byteLength(text, 'utf8') <= maxBytes, {
    message: `${what} is at most ${String(maxBytes)} bytes. Shorten it.`,
  });
}

const idSchema = z.string().regex(/^[a-z0-9-]{1,48}$/, ID_MESSAGE);
const titleSchema = z.string().trim().min(1).max(DOCUMENT_LIMITS.maxTitleLength);
const tokenNoteSchema = textOfAtMost(DOCUMENT_LIMITS.maxTokenNoteBytes, 'A usage note').optional();
const itemNoteSchema = textOfAtMost(
  DOCUMENT_LIMITS.maxItemNoteBytes,
  'A preview or asset note',
).optional();

const noteSchema = z
  .object({
    kind: z.literal('note'),
    id: idSchema,
    label: z
      .string()
      .max(48, LABEL_MESSAGE)
      .regex(/^[a-z0-9][a-z0-9-]*\.md$/, LABEL_MESSAGE),
    body: textOfAtMost(DOCUMENT_LIMITS.maxNoteBytes, 'A note'),
    author: z.enum(['user', 'agent']),
  })
  .strict();

const tokenSchema = z.union([
  z.object({ name: tokenNameSchema, note: tokenNoteSchema, value: tokenValueSchema }).strict(),
  z
    .object({
      name: tokenNameSchema,
      note: tokenNoteSchema,
      light: tokenValueSchema,
      dark: tokenValueSchema,
    })
    .strict(),
]);

const tokenGroupSchema = z
  .object({
    kind: z.literal('group'),
    id: idSchema,
    title: titleSchema,
    tokens: z.array(tokenSchema).max(DOCUMENT_LIMITS.maxTokens),
  })
  .strict();

const { previewWidthPx, previewHeightPx } = DOCUMENT_LIMITS;
const previewSchema = z
  .object({
    kind: z.literal('preview'),
    id: idSchema,
    title: titleSchema,
    example: sourcePathSchema,
    width: z.number().int().min(previewWidthPx.min).max(previewWidthPx.max),
    height: z.number().int().min(previewHeightPx.min).max(previewHeightPx.max),
    note: itemNoteSchema,
  })
  .strict();

const assetSchema = z
  .object({
    kind: z.literal('asset'),
    id: idSchema,
    name: titleSchema,
    assetId: z.string().regex(/^[0-9a-f]{64}$/),
    note: itemNoteSchema,
  })
  .strict();

const sectionFields = { id: idSchema, title: titleSchema };
const items = <Item extends z.ZodTypeAny>(item: Item) =>
  z.array(item).max(DOCUMENT_LIMITS.maxItemsPerSection);
const noteOrPreview = z.discriminatedUnion('kind', [noteSchema, previewSchema]);

const sectionSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('notes'), ...sectionFields, items: items(noteOrPreview) }).strict(),
  z
    .object({
      kind: z.enum(TOKEN_KINDS),
      ...sectionFields,
      items: items(z.discriminatedUnion('kind', [noteSchema, tokenGroupSchema])),
    })
    .strict(),
  z
    .object({ kind: z.literal('components'), ...sectionFields, items: items(noteOrPreview) })
    .strict(),
  z
    .object({
      kind: z.literal('assets'),
      ...sectionFields,
      items: items(z.discriminatedUnion('kind', [noteSchema, assetSchema])),
    })
    .strict(),
]);

export type DocumentSection = z.infer<typeof sectionSchema>;
type DocumentItem = DocumentSection['items'][number];

/** A document's sections in reading order; the order saved is the order shown. */
export const documentSectionsSchema = z
  .array(sectionSchema)
  .max(
    DOCUMENT_LIMITS.maxSections,
    `A design system has at most ${String(DOCUMENT_LIMITS.maxSections)} sections.`,
  )
  .superRefine((sections, context) => {
    const problem = documentProblem(sections);
    if (problem) context.addIssue({ code: z.ZodIssueCode.custom, message: problem });
  });

// The rules that span sections: one section per kind but notes, ids and the
// natural keys an agent's change names (token names, note labels, preview
// titles, asset names) unique in the whole document, and the document-wide counts.
function documentProblem(sections: DocumentSection[]): string | null {
  const kinds = new Set<string>();
  const ids = new Set<string>();
  const labels = new Set<string>();
  const tokenNames = new Set<string>();
  const previewTitles = new Set<string>();
  const assetNames = new Set<string>();
  for (const section of sections) {
    if (section.kind !== 'notes' && !claim(kinds, section.kind))
      return `A design system has one ${section.kind} section. Move "${section.title}" into it.`;
    if (!claim(ids, section.id)) return duplicateId(section.id);
    for (const item of section.items) {
      if (!claim(ids, item.id)) return duplicateId(item.id);
      if (item.kind === 'note' && !claim(labels, item.label))
        return `Two notes are called ${item.label}. Rename one.`;
      if (item.kind === 'group') {
        const repeated = item.tokens.find((token) => !claim(tokenNames, token.name));
        if (repeated) return `${repeated.name} is declared twice. Keep one.`;
      }
      if (item.kind === 'preview' && RESERVED_PREVIEW_IDS.has(item.id))
        return `A preview cannot use the id ${item.id}. Choose another.`;
      if (item.kind === 'preview' && !claim(previewTitles, item.title))
        return `Two previews are called ${item.title}. Rename one.`;
      if (item.kind === 'asset' && !claim(assetNames, item.name))
        return `Two images are called ${item.name}. Rename one.`;
    }
  }
  const allItems = sections.flatMap<DocumentItem>((section) => section.items);
  const previews = allItems.filter((item) => item.kind === 'preview').length;
  const assets = allItems.filter((item) => item.kind === 'asset').length;
  if (tokenNames.size > DOCUMENT_LIMITS.maxTokens)
    return `A design system declares at most ${String(DOCUMENT_LIMITS.maxTokens)} tokens.`;
  if (previews > DOCUMENT_LIMITS.maxPreviews)
    return `A design system has at most ${String(DOCUMENT_LIMITS.maxPreviews)} previews.`;
  if (assets > DOCUMENT_LIMITS.maxAssets)
    return `A design system has at most ${String(DOCUMENT_LIMITS.maxAssets)} images.`;
  return null;
}

function claim(seen: Set<string>, key: string): boolean {
  if (seen.has(key)) return false;
  seen.add(key);
  return true;
}

function duplicateId(id: string): string {
  return `The id ${id} is used twice. Give each section and item its own id.`;
}

/** The tokens the compiler injects per mode; a single-value token gives both modes its value. */
export function kitModes(sections: DocumentSection[]): {
  light: Record<string, string>;
  dark: Record<string, string>;
} {
  const light: Record<string, string> = {};
  const dark: Record<string, string> = {};
  for (const section of sections) {
    for (const item of section.items) {
      if (item.kind !== 'group') continue;
      for (const token of item.tokens) {
        light[token.name] = 'value' in token ? token.value : token.light;
        dark[token.name] = 'value' in token ? token.value : token.dark;
      }
    }
  }
  return { light, dark };
}

/**
 * The document's text as the agent reads it, in document order: section
 * titles, notes, then the usage notes of tokens and previews. Tokens without a
 * note are already in the brief's name list, so they are not repeated.
 */
export function kitGuidance(name: string, sections: DocumentSection[]): string {
  const blocks = [`# ${name}`];
  for (const section of sections) {
    blocks.push(`## ${section.title}`);
    let usage: string[] = [];
    for (const item of section.items) {
      if (item.kind !== 'note') {
        usage.push(...usageNotes(item));
        continue;
      }
      if (usage.length > 0) blocks.push(usage.join('\n'));
      usage = [];
      blocks.push(`### ${item.label}\n\n${item.body}`);
    }
    if (usage.length > 0) blocks.push(usage.join('\n'));
  }
  return blocks.join('\n\n');
}

/** The label of the note that costs the agent the most, for a refusal to name. */
export function largestNote(sections: DocumentSection[]): string | null {
  let largest: { label: string; bytes: number } | null = null;
  for (const section of sections)
    for (const item of section.items) {
      if (item.kind !== 'note') continue;
      const bytes = Buffer.byteLength(item.body, 'utf8');
      if (!largest || bytes > largest.bytes) largest = { label: item.label, bytes };
    }
  return largest?.label ?? null;
}

/**
 * Sets every note's author from who saved (§2): a note whose label and body
 * match the base note with its id keeps that author; any other is the saver's.
 */
export function withNoteAuthors(
  sections: DocumentSection[],
  base: DocumentSection[],
  author: 'user' | 'agent',
): DocumentSection[] {
  const before = new Map<string, Extract<DocumentItem, { kind: 'note' }>>();
  for (const section of base)
    for (const item of section.items) if (item.kind === 'note') before.set(item.id, item);
  const authored = structuredClone(sections);
  for (const section of authored)
    for (const item of section.items) {
      if (item.kind !== 'note') continue;
      const earlier = before.get(item.id);
      const unchanged = earlier?.label === item.label && earlier.body === item.body;
      item.author = unchanged ? earlier.author : author;
    }
  return authored;
}

function usageNotes(item: DocumentItem): string[] {
  if (item.kind === 'group')
    return item.tokens.flatMap((token) => (token.note ? [`- ${token.name}: ${token.note}`] : []));
  if (item.kind === 'preview' && item.note) return [`- ${item.title}: ${item.note}`];
  return [];
}

/** Inserts a section before the first one that comes after it in the canonical order. */
export function insertSection(
  sections: DocumentSection[],
  section: DocumentSection,
): DocumentSection[] {
  const rank = CANONICAL_SECTION_ORDER.indexOf(section.kind);
  const at = sections.findIndex(
    (existing) => CANONICAL_SECTION_ORDER.indexOf(existing.kind) > rank,
  );
  if (at === -1) return [...sections, section];
  return [...sections.slice(0, at), section, ...sections.slice(at)];
}
