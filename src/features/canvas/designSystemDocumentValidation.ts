// The renderer's check of a design system document a Canvas reply carries. Its
// bounds mirror `documentSectionsSchema` in the sidecar's designSystemDocument.ts;
// wireValidation.ts owns the rest of the reply.

import type { DocumentSection } from './designSystemDocumentProtocol';
import { boundedList, boundedText, record } from './wireChecks';

const MAX_SECTIONS = 16;
const MAX_ITEMS_PER_SECTION = 64;
const MAX_TITLE_LENGTH = 120;
const MAX_TOKENS = 128;
const MAX_TOKEN_VALUE_LENGTH = 160;
const MAX_TOKEN_NOTE_BYTES = 400;
const MAX_NOTE_BYTES = 8 * 1024;
const MAX_ITEM_NOTE_BYTES = 1024;
const MAX_PREVIEWS = 24;
const MAX_ASSETS = 48;
// The sidecar's `sourcePathSchema` bound, which an example file's name shares.
const MAX_EXAMPLE_PATH_LENGTH = 256;
const TOKEN_KINDS = new Set<unknown>([
  'colors',
  'typography',
  'spacing',
  'radius',
  'shadows',
  'motion',
  'tokens',
]);
const ITEM_ID = /^[a-z0-9-]{1,48}$/;
const NOTE_LABEL = /^[a-z0-9][a-z0-9-]*\.md$/;
const TOKEN_NAME = /^--[a-z0-9]+(-[a-z0-9]+)*$/;
const ASSET_ID = /^[0-9a-f]{64}$/;
const utf8 = new TextEncoder();

export function isTokenName(value: unknown): boolean {
  return typeof value === 'string' && TOKEN_NAME.test(value);
}

export function isTokenValue(value: unknown): boolean {
  return boundedText(value, MAX_TOKEN_VALUE_LENGTH);
}

export function isDocumentSections(value: unknown): value is DocumentSection[] {
  return (
    Array.isArray(value) &&
    value.length <= MAX_SECTIONS &&
    value.every(isSection) &&
    isConsistent(value)
  );
}

function isSection(value: unknown): value is DocumentSection {
  if (!record(value) || !isItemId(value.id) || !boundedText(value.title, MAX_TITLE_LENGTH))
    return false;
  const isItem = itemCheck(value.kind);
  return isItem !== null && boundedList(value.items, MAX_ITEMS_PER_SECTION, isItem);
}

function itemCheck(kind: unknown): ((item: unknown) => boolean) | null {
  if (kind === 'notes' || kind === 'components') return (item) => isNote(item) || isPreview(item);
  if (kind === 'assets') return (item) => isNote(item) || isAsset(item);
  if (TOKEN_KINDS.has(kind)) return (item) => isNote(item) || isTokenGroup(item);
  return null;
}

function isNote(value: unknown): boolean {
  return (
    record(value) &&
    value.kind === 'note' &&
    isItemId(value.id) &&
    boundedText(value.label, 48) &&
    NOTE_LABEL.test(value.label as string) &&
    isTextOfAtMost(value.body, MAX_NOTE_BYTES) &&
    (value.author === 'user' || value.author === 'agent')
  );
}

function isTokenGroup(value: unknown): boolean {
  return (
    record(value) &&
    value.kind === 'group' &&
    isItemId(value.id) &&
    boundedText(value.title, MAX_TITLE_LENGTH) &&
    boundedList(value.tokens, MAX_TOKENS, isToken)
  );
}

function isToken(value: unknown): boolean {
  if (
    !record(value) ||
    !isTokenName(value.name) ||
    !isOptionalNote(value.note, MAX_TOKEN_NOTE_BYTES)
  )
    return false;
  if (value.value !== undefined)
    return isTokenValue(value.value) && value.light === undefined && value.dark === undefined;
  return isTokenValue(value.light) && isTokenValue(value.dark);
}

function isPreview(value: unknown): boolean {
  return (
    record(value) &&
    value.kind === 'preview' &&
    isItemId(value.id) &&
    boundedText(value.title, MAX_TITLE_LENGTH) &&
    boundedText(value.example, MAX_EXAMPLE_PATH_LENGTH) &&
    isWholeBetween(value.width, 240, 1440) &&
    isWholeBetween(value.height, 120, 1200) &&
    isOptionalNote(value.note, MAX_ITEM_NOTE_BYTES)
  );
}

function isAsset(value: unknown): boolean {
  return (
    record(value) &&
    value.kind === 'asset' &&
    isItemId(value.id) &&
    boundedText(value.name, MAX_TITLE_LENGTH) &&
    typeof value.assetId === 'string' &&
    ASSET_ID.test(value.assetId) &&
    isOptionalNote(value.note, MAX_ITEM_NOTE_BYTES)
  );
}

// The rules that span sections, as the sidecar checks them: one section per
// kind but notes, unique ids, labels and token names, and the document's counts.
function isConsistent(sections: DocumentSection[]): boolean {
  const kinds = new Set<string>();
  const ids = new Set<string>();
  const labels = new Set<string>();
  const tokenNames = new Set<string>();
  let previews = 0;
  let assets = 0;
  for (const section of sections) {
    if (section.kind !== 'notes' && !claim(kinds, section.kind)) return false;
    if (!claim(ids, section.id)) return false;
    for (const item of section.items) {
      if (!claim(ids, item.id)) return false;
      if (item.kind === 'note' && !claim(labels, item.label)) return false;
      if (item.kind === 'group' && !item.tokens.every((token) => claim(tokenNames, token.name)))
        return false;
      if (item.kind === 'preview') previews += 1;
      if (item.kind === 'asset') assets += 1;
    }
  }
  return tokenNames.size <= MAX_TOKENS && previews <= MAX_PREVIEWS && assets <= MAX_ASSETS;
}

function claim(seen: Set<string>, key: string): boolean {
  if (seen.has(key)) return false;
  seen.add(key);
  return true;
}

function isItemId(value: unknown): boolean {
  return typeof value === 'string' && ITEM_ID.test(value);
}

function isTextOfAtMost(value: unknown, maxBytes: number): boolean {
  return typeof value === 'string' && utf8.encode(value).byteLength <= maxBytes;
}

function isOptionalNote(value: unknown, maxBytes: number): boolean {
  return value === undefined || isTextOfAtMost(value, maxBytes);
}

function isWholeBetween(value: unknown, min: number, max: number): boolean {
  return typeof value === 'number' && Number.isInteger(value) && value >= min && value <= max;
}
