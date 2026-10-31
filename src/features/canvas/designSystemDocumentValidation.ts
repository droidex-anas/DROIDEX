// The renderer's check of a design system document a Canvas reply carries. Its
// rules mirror `documentSectionsSchema` in the sidecar's designSystemDocument.ts
// and the kit replies of its designSystemCommands.ts; wireValidation.ts owns
// the rest of the reply.

import type { DocumentSection } from './designSystemDocumentProtocol';
import { boundedList, boundedText, count, id, isAppSessionId, record } from './wireChecks';

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
// `DESIGN_SYSTEM_LIMITS.maxNameLength` in the sidecar's designSystems.ts.
export const MAX_KIT_NAME_LENGTH = 120;
// The sidecar's `CANVAS_LIMITS`: an example file's name is a source path, and
// a kit holds as many examples as a design holds files.
const MAX_SOURCE_PATH_LENGTH = 256;
const MAX_EXAMPLES = 64;
const TOKEN_KINDS = new Set<unknown>([
  'colors',
  'typography',
  'spacing',
  'radius',
  'shadows',
  'motion',
  'tokens',
]);
// Preview targets of their own beside the previews' ids.
const RESERVED_PREVIEW_IDS = new Set(['cover', 'typography']);
const RESERVED_PATH_SEGMENTS = new Set(['__proto__', 'constructor', 'prototype']);
const ITEM_ID = /^[a-z0-9-]{1,48}$/;
const NOTE_LABEL = /^[a-z0-9][a-z0-9-]*\.md$/;
const TOKEN_NAME = /^--[a-z0-9]+(-[a-z0-9]+)*$/;
const ASSET_ID = /^[0-9a-f]{64}$/;
const UNSAFE_TOKEN_VALUE = /[;{}<>\n\r\t]|\/\*/;
const UNPAIRED_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;
const utf8 = new TextEncoder();

function isTokenName(value: unknown): boolean {
  return typeof value === 'string' && TOKEN_NAME.test(value);
}

/** A value the sidecar trims and then pastes into a stylesheet rule. */
function isTokenValue(value: unknown): boolean {
  if (typeof value !== 'string') return false;
  const trimmed = value.trim();
  return boundedText(trimmed, MAX_TOKEN_VALUE_LENGTH) && !UNSAFE_TOKEN_VALUE.test(trimmed);
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
  if (
    !hasOnlyKeys(value, ['kind', 'id', 'title', 'items']) ||
    !isItemId(value.id) ||
    !isTitle(value.title)
  )
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
    hasOnlyKeys(value, ['kind', 'id', 'label', 'body', 'author']) &&
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
    hasOnlyKeys(value, ['kind', 'id', 'title', 'tokens']) &&
    value.kind === 'group' &&
    isItemId(value.id) &&
    isTitle(value.title) &&
    boundedList(value.tokens, MAX_TOKENS, isToken)
  );
}

function isToken(value: unknown): boolean {
  if (hasOnlyKeys(value, ['name', 'note', 'value']) && value.value !== undefined)
    return (
      isTokenName(value.name) &&
      isOptionalNote(value.note, MAX_TOKEN_NOTE_BYTES) &&
      isTokenValue(value.value)
    );
  return (
    hasOnlyKeys(value, ['name', 'note', 'light', 'dark']) &&
    isTokenName(value.name) &&
    isOptionalNote(value.note, MAX_TOKEN_NOTE_BYTES) &&
    isTokenValue(value.light) &&
    isTokenValue(value.dark)
  );
}

function isPreview(value: unknown): boolean {
  return (
    hasOnlyKeys(value, ['kind', 'id', 'title', 'example', 'width', 'height', 'note']) &&
    value.kind === 'preview' &&
    isItemId(value.id) &&
    isTitle(value.title) &&
    isExamplePath(value.example) &&
    isWholeBetween(value.width, 240, 1440) &&
    isWholeBetween(value.height, 120, 1200) &&
    isOptionalNote(value.note, MAX_ITEM_NOTE_BYTES)
  );
}

function isAsset(value: unknown): boolean {
  return (
    hasOnlyKeys(value, ['kind', 'id', 'name', 'assetId', 'note']) &&
    value.kind === 'asset' &&
    isItemId(value.id) &&
    isTitle(value.name) &&
    isAssetId(value.assetId) &&
    isOptionalNote(value.note, MAX_ITEM_NOTE_BYTES)
  );
}

// The rules that span sections, as the sidecar checks them: one section per
// kind but notes, unique ids and natural keys (labels, token names, preview
// titles, asset names), no reserved preview id, and the document's counts.
function isConsistent(sections: DocumentSection[]): boolean {
  const kinds = new Set<string>();
  const ids = new Set<string>();
  const labels = new Set<string>();
  const tokenNames = new Set<string>();
  const previewTitles = new Set<string>();
  const assetNames = new Set<string>();
  for (const section of sections) {
    if (section.kind !== 'notes' && !claim(kinds, section.kind)) return false;
    if (!claim(ids, section.id)) return false;
    for (const item of section.items) {
      if (!claim(ids, item.id)) return false;
      if (item.kind === 'note' && !claim(labels, item.label)) return false;
      if (item.kind === 'group' && !item.tokens.every((token) => claim(tokenNames, token.name)))
        return false;
      if (
        item.kind === 'preview' &&
        (RESERVED_PREVIEW_IDS.has(item.id) || !claim(previewTitles, item.title.trim()))
      )
        return false;
      if (item.kind === 'asset' && !claim(assetNames, item.name.trim())) return false;
    }
  }
  return (
    tokenNames.size <= MAX_TOKENS &&
    previewTitles.size <= MAX_PREVIEWS &&
    assetNames.size <= MAX_ASSETS
  );
}

/** A row of the design-system list. */
export function isKitSummary(value: unknown): boolean {
  if (!isKitVersion(value) || !record(value.swatches)) return false;
  const { light, dark } = value.swatches;
  return (
    boundedText(value.name, MAX_KIT_NAME_LENGTH) &&
    isKitKind(value.kind) &&
    [light, dark].every(
      (swatch) => record(swatch) && isTokenValue(swatch.surface) && isTokenValue(swatch.accent),
    ) &&
    typeof value.cover === 'boolean' &&
    (value.savedAt === null || isTimestamp(value.savedAt)) &&
    typeof value.proposal === 'boolean'
  );
}

/** A kit version as its document shows it. */
export function isKitDocument(value: unknown): boolean {
  return (
    isKitVersion(value) &&
    count(value.latestVersion) &&
    boundedText(value.name, MAX_KIT_NAME_LENGTH) &&
    isKitKind(value.kind) &&
    isCover(value.cover) &&
    isDocumentSections(value.sections) &&
    boundedList(value.examples, MAX_EXAMPLES, isExamplePath) &&
    boundedList(value.unmapped, MAX_TOKENS, isTokenName) &&
    (value.provenance === null || isKitProvenance(value.provenance)) &&
    (value.savedAt === null || isTimestamp(value.savedAt)) &&
    (value.savedBy === null || isSavedBy(value.savedBy)) &&
    value.proposal === null
  );
}

/** One entry of a kit's version history. */
export function isKitVersionEntry(value: unknown): boolean {
  return (
    record(value) && count(value.version) && isTimestamp(value.savedAt) && isSavedBy(value.savedBy)
  );
}

export function isKitVersion(value: unknown): value is Record<string, unknown> {
  return record(value) && id(value.id) && count(value.version);
}

function isKitKind(value: unknown): boolean {
  return value === 'auto' || value === 'preset' || value === 'user';
}

function isCover(value: unknown): boolean {
  if (value === null) return true;
  if (hasOnlyKeys(value, ['kind', 'example']) && value.kind === 'preview')
    return isExamplePath(value.example);
  return (
    hasOnlyKeys(value, ['kind', 'assetId']) && value.kind === 'image' && isAssetId(value.assetId)
  );
}

function isKitProvenance(value: unknown): boolean {
  if (!record(value)) return false;
  if (value.copiedFrom !== undefined) return isKitVersion(value.copiedFrom);
  return (
    id(value.sourceCanvasId) &&
    record(value.revision) &&
    id(value.revision.designId) &&
    id(value.revision.revisionId)
  );
}

function isSavedBy(value: unknown): boolean {
  if (!record(value)) return false;
  return value.actor === 'user' || (value.actor === 'agent' && isAppSessionId(value.appSessionId));
}

function isTimestamp(value: unknown): boolean {
  return typeof value === 'string' && !Number.isNaN(Date.parse(value));
}

/** A name in the kit's examples, held to the sidecar's `sourcePathSchema`. */
function isExamplePath(value: unknown): boolean {
  if (typeof value !== 'string' || value.length === 0 || value.length > MAX_SOURCE_PATH_LENGTH)
    return false;
  if (value.includes('\\') || hasControlCharacter(value) || UNPAIRED_SURROGATE.test(value))
    return false;
  return value
    .split('/')
    .every(
      (segment) =>
        segment !== '' &&
        segment !== '.' &&
        segment !== '..' &&
        !RESERVED_PATH_SEGMENTS.has(segment),
    );
}

function hasControlCharacter(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code < 0x20 || (code >= 0x7f && code <= 0x9f)) return true;
  }
  return false;
}

function hasOnlyKeys(value: unknown, keys: readonly string[]): value is Record<string, unknown> {
  return record(value) && Object.keys(value).every((key) => keys.includes(key));
}

function claim(seen: Set<string>, key: string): boolean {
  if (seen.has(key)) return false;
  seen.add(key);
  return true;
}

function isItemId(value: unknown): boolean {
  return typeof value === 'string' && ITEM_ID.test(value);
}

function isTitle(value: unknown): boolean {
  return typeof value === 'string' && boundedText(value.trim(), MAX_TITLE_LENGTH);
}

function isAssetId(value: unknown): boolean {
  return typeof value === 'string' && ASSET_ID.test(value);
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
