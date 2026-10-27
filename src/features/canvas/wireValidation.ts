// The renderer's boundary for inbound Canvas events. The sidecar owns the
// authoritative schema; this checks the shape the projection relies on before
// any feature code can observe it.

import { isAnnotation, isAnnotationChange, MAX_ANNOTATIONS } from './annotationValidation';
import type { CanvasEvent } from './protocol';
import {
  boundedList,
  boundedText,
  count,
  id,
  isAppSessionId,
  isRect,
  list,
  record,
  text,
} from './wireChecks';

const ERROR_CODES = new Set([
  'invalid_input',
  'revision_conflict',
  'preset_read_only',
  'version_mismatch',
  'invalid_source_path',
  'unsupported_import',
  'build_timeout',
  'capture_unavailable',
  'scope_expired',
  'unknown_chat',
  'storage_failed',
  'stale_revision',
  'stale_reference',
  'ambiguous_element',
  'invalid_edit',
  'invalid_source',
  'unsupported_edit',
  'layout_conflict',
  'not_found',
]);

const REPLY_KINDS = new Set([
  'ok',
  'summaries',
  'assets',
  'attachment',
  'canvasCreated',
  'created',
  'written',
  'edited',
  'arranged',
  'removed',
  'undone',
  'renamed',
  'annotated',
  'artifact',
  'source',
  'revisions',
  'revisionDiff',
  'designSystems',
  'designSystem',
  'designSystemSaved',
  'libraryItem',
  'libraryItems',
  'removalPreview',
]);

const ADHERENCE_RULES = new Set<unknown>(['off', 'guide', 'strict']);

/** An artifact document, bounded well above a realistic design (spec §5). */
const MAX_ARTIFACT_BYTES = 8 * 1024 * 1024;
const MAX_SOURCE_ELEMENTS = 8192;
const MAX_BUILD_DIAGNOSTICS = 64;
const MAX_SOURCE_FILE_BYTES = 256 * 1024;
// What one revision's tree may hold, matching `CANVAS_LIMITS` in the sidecar's
// schema: 64 files, each path at most 256 characters.
const MAX_SOURCE_PATHS = 64;
const MAX_SOURCE_PATH_LENGTH = 256;
const MAX_REVISION_PAGE_SIZE = 50;
const MAX_REVISION_DIFF_BYTES = 256 * 1024;
// `LIBRARY_LIST_LIMIT` in the sidecar's canvasLibrary.ts.
const MAX_LIBRARY_ITEMS = 50;
// The sidecar's `CANVAS_LIMITS.maxFrameNameLength`, which bounds a library item's name too.
export const MAX_FRAME_NAME_LENGTH = 120;
// A kit's bounds, matching `DESIGN_SYSTEM_LIMITS` in the sidecar's designSystems.ts.
export const MAX_KIT_NAME_LENGTH = 120;
const MAX_KIT_TOKENS = 128;
const MAX_TOKEN_VALUE_LENGTH = 160;
const TOKEN_NAME = /^--[a-z0-9]+(-[a-z0-9]+)*$/;
const utf8 = new TextEncoder();

export function isCanvasEvent(value: Record<string, unknown>): value is CanvasEvent {
  switch (value.type) {
    case 'canvas.summaries':
      return list(value.summaries, isSummary);
    case 'canvas.snapshot':
      return id(value.requestId) && isSnapshot(value.snapshot);
    case 'canvas.change':
      return isChange(value.change);
    case 'canvas.captureRequest':
      return (
        id(value.captureId) && id(value.canvasId) && id(value.designId) && id(value.revisionId)
      );
    case 'canvas.result':
      if (!id(value.requestId)) return false;
      return value.ok === true ? isReply(value.reply) : value.ok === false && isError(value.error);
    default:
      return false;
  }
}

function isReply(value: unknown): boolean {
  if (!record(value) || typeof value.kind !== 'string' || !REPLY_KINDS.has(value.kind))
    return false;
  switch (value.kind) {
    case 'summaries':
      return list(value.summaries, isSummary);
    case 'assets':
      return list(
        value.assets,
        (asset) =>
          record(asset) &&
          typeof asset.assetId === 'string' &&
          /^[0-9a-f]{64}$/.test(asset.assetId) &&
          (asset.mediaType === 'image/png' ||
            asset.mediaType === 'image/jpeg' ||
            asset.mediaType === 'image/webp') &&
          count(asset.byteLength) &&
          asset.byteLength > 0 &&
          asset.byteLength <= 10 * 1024 * 1024 &&
          count(asset.width) &&
          asset.width > 0 &&
          asset.width <= 8192 &&
          count(asset.height) &&
          asset.height > 0 &&
          asset.height <= 8192,
      );
    case 'attachment':
      return (
        (value.canvasId === null || id(value.canvasId)) &&
        (value.outdated === undefined ||
          (record(value.outdated) && id(value.outdated.canvasId) && text(value.outdated.name)))
      );
    case 'canvasCreated':
      return id(value.canvasId) && (value.attachedCanvasId === null || id(value.attachedCanvasId));
    case 'created':
      return (
        record(value.created) && id(value.created.canvasId) && list(value.created.frames, isFrame)
      );
    case 'written':
      return isReceipt(value.receipt);
    case 'edited':
      return (
        isReceipt(value.receipt) &&
        (value.resolution === null || isStyleResolution(value.resolution))
      );
    case 'arranged':
    case 'undone':
    case 'renamed':
    case 'annotated':
      return isChange(value.change);
    case 'removed':
      return id(value.undoId);
    case 'artifact':
      return value.artifact === null || isArtifact(value.artifact);
    case 'source':
      return isSourceTree(value.files);
    case 'revisions':
      return boundedList(value.revisions, MAX_REVISION_PAGE_SIZE, isRevisionSummary);
    case 'revisionDiff':
      return isRevisionDiff(value.diff);
    case 'designSystems':
      return list(value.systems, isKitSummary);
    case 'designSystem':
      return isKitDetail(value.system);
    case 'designSystemSaved':
      return (
        isKitVersion(value.ref) &&
        boundedList(value.diagnostics, MAX_BUILD_DIAGNOSTICS, isDiagnostic)
      );
    case 'libraryItem':
      return isLibraryItem(value.item);
    case 'libraryItems':
      return boundedList(value.items, MAX_LIBRARY_ITEMS, isLibraryItem);
    case 'removalPreview':
      return (
        record(value.preview) &&
        id(value.preview.canvasId) &&
        text(value.preview.name) &&
        count(value.preview.sequence) &&
        list(value.preview.attachedAppSessionIds, isAppSessionId) &&
        list(value.preview.activeTurnAppSessionIds, isAppSessionId) &&
        list(value.preview.buildingDesignIds, id)
      );
    default:
      return true;
  }
}

function isLibraryItem(value: unknown): boolean {
  return (
    record(value) &&
    id(value.itemId) &&
    boundedText(value.name, MAX_FRAME_NAME_LENGTH) &&
    id(value.sourceCanvasId) &&
    record(value.source) &&
    id(value.source.designId) &&
    id(value.source.revisionId) &&
    isDesignSystem(value.designSystem)
  );
}

function isKitVersion(value: unknown): value is Record<string, unknown> {
  return record(value) && id(value.id) && count(value.version);
}

function isKitSummary(value: unknown): boolean {
  if (!isKitVersion(value) || !record(value.swatches)) return false;
  const { light, dark } = value.swatches;
  return (
    boundedText(value.name, MAX_KIT_NAME_LENGTH) &&
    (value.kind === 'preset' || value.kind === 'user') &&
    [light, dark].every(
      (swatch) =>
        record(swatch) &&
        boundedText(swatch.surface, MAX_TOKEN_VALUE_LENGTH) &&
        boundedText(swatch.accent, MAX_TOKEN_VALUE_LENGTH),
    )
  );
}

function isKitDetail(value: unknown): boolean {
  if (!isKitVersion(value) || !record(value.modes)) return false;
  return (
    boundedText(value.name, MAX_KIT_NAME_LENGTH) &&
    isKitTokens(value.modes.light) &&
    isKitTokens(value.modes.dark) &&
    boundedList(
      value.unmapped,
      MAX_KIT_TOKENS,
      (name) => typeof name === 'string' && TOKEN_NAME.test(name),
    ) &&
    (value.provenance === null || isKitProvenance(value.provenance))
  );
}

function isKitTokens(value: unknown): boolean {
  if (!record(value)) return false;
  const names = Object.keys(value);
  return (
    names.length <= MAX_KIT_TOKENS &&
    names.every((name) => TOKEN_NAME.test(name) && boundedText(value[name], MAX_TOKEN_VALUE_LENGTH))
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

function isSourceTree(value: unknown): boolean {
  if (!record(value)) return false;
  const paths = Object.keys(value);
  return (
    paths.length <= MAX_SOURCE_PATHS &&
    paths.every((path) => {
      const content = value[path];
      return (
        boundedText(path, MAX_SOURCE_PATH_LENGTH) &&
        typeof content === 'string' &&
        content.length <= MAX_SOURCE_FILE_BYTES
      );
    })
  );
}

function isRevisionSummary(value: unknown): boolean {
  if (!isRevisionCommit(value)) return false;
  if (value.state === 'damaged') return true;
  return (
    value.state === 'saved' &&
    (value.restoredFromRevisionId === undefined || id(value.restoredFromRevisionId)) &&
    count(value.createdAt) &&
    isDesignSystem(value.designSystem) &&
    typeof value.buildStatus === 'string' &&
    ['ready', 'failed', 'building', 'unbuilt'].includes(value.buildStatus)
  );
}

function isRevisionCommit(value: unknown): value is Record<string, unknown> {
  if (!record(value) || !record(value.author)) return false;
  return (
    id(value.revisionId) &&
    count(value.sequence) &&
    (value.author.kind === 'user' ||
      (value.author.kind === 'agent' && id(value.author.scopeRef))) &&
    typeof value.mutationKind === 'string' &&
    ['create', 'write', 'edit', 'restore'].includes(value.mutationKind)
  );
}

// Two revisions can name up to twice one tree's paths; the diff text shares one byte cap.
function isRevisionDiff(value: unknown): boolean {
  if (!record(value) || !id(value.from) || !id(value.to)) return false;
  let bytes = 0;
  return boundedList(value.files, MAX_SOURCE_PATHS * 2, (file) => {
    if (
      !record(file) ||
      !boundedText(file.path, MAX_SOURCE_PATH_LENGTH) ||
      typeof file.diff !== 'string' ||
      typeof file.truncated !== 'boolean' ||
      typeof file.kind !== 'string' ||
      !['added', 'removed', 'modified'].includes(file.kind)
    )
      return false;
    if (file.diff.length > MAX_REVISION_DIFF_BYTES) return false;
    bytes += utf8.encode(file.diff).byteLength;
    return bytes <= MAX_REVISION_DIFF_BYTES;
  });
}

function isArtifact(value: unknown): boolean {
  return (
    record(value) &&
    id(value.artifactId) &&
    typeof value.html === 'string' &&
    value.html.length > 0 &&
    value.html.length <= MAX_ARTIFACT_BYTES
  );
}

function isFrameProjection(value: unknown): value is Record<string, unknown> {
  return (
    record(value) && id(value.canvasId) && count(value.sequence) && list(value.frames, isFrame)
  );
}

function isSnapshot(value: unknown): boolean {
  return (
    isFrameProjection(value) &&
    count(value.annotationsVersion) &&
    boundedList(value.annotations, MAX_ANNOTATIONS, isAnnotation)
  );
}

function isChange(value: unknown): boolean {
  return (
    isFrameProjection(value) &&
    list(value.removedDesignIds, id) &&
    (value.annotations === undefined || isAnnotationChange(value.annotations))
  );
}

function isSummary(value: unknown): boolean {
  return (
    record(value) &&
    id(value.canvasId) &&
    text(value.name) &&
    count(value.updatedAt) &&
    count(value.designCount) &&
    list(value.attachedAppSessionIds, isAppSessionId) &&
    ADHERENCE_RULES.has(value.designSystemAdherence)
  );
}

function isReceipt(value: unknown): boolean {
  return record(value) && id(value.designId) && id(value.revisionId) && count(value.sequence);
}

function isStyleResolution(value: unknown): boolean {
  if (!record(value)) return false;
  if (value.kind === 'token') return boundedText(value.token, 128);
  return value.kind === 'raw' && boundedText(value.value, 128);
}

function isFrame(value: unknown): boolean {
  return (
    record(value) &&
    id(value.designId) &&
    text(value.name) &&
    isRect(value.rect) &&
    count(value.layoutVersion) &&
    count(value.manifestVersion) &&
    (value.revisionId === null || id(value.revisionId)) &&
    isDesignSystem(value.designSystem) &&
    isBuild(value.build)
  );
}

function isDesignSystem(value: unknown): boolean {
  return (
    record(value) &&
    id(value.id) &&
    count(value.version) &&
    (value.mode === 'light' || value.mode === 'dark')
  );
}

function isBuild(value: unknown): boolean {
  // Every state names the attempt it belongs to, whatever the attempt produced.
  if (!record(value) || !count(value.generation)) return false;
  switch (value.status) {
    case 'pending':
      return true;
    case 'building':
      return id(value.revisionId);
    case 'ready':
      return (
        id(value.revisionId) &&
        id(value.artifactId) &&
        boundedList(value.elements, MAX_SOURCE_ELEMENTS, isSourceElement) &&
        boundedList(value.diagnostics, MAX_BUILD_DIAGNOSTICS, isDiagnostic)
      );
    case 'failed':
      return (
        id(value.revisionId) &&
        boundedList(value.diagnostics, MAX_BUILD_DIAGNOSTICS, isDiagnostic) &&
        (value.lastWorkingRevisionId === null || id(value.lastWorkingRevisionId))
      );
    case 'cancelled':
      return value.revisionId === null || id(value.revisionId);
    default:
      return false;
  }
}

function isSourceElement(value: unknown): boolean {
  return (
    record(value) &&
    id(value.elementId) &&
    boundedText(value.file, 256) &&
    count(value.start) &&
    count(value.end) &&
    value.end > value.start &&
    value.end <= MAX_SOURCE_FILE_BYTES &&
    boundedText(value.tagName, MAX_SOURCE_FILE_BYTES) &&
    (value.editability === 'literal' ||
      value.editability === 'computed' ||
      value.editability === 'shared')
  );
}

function isDiagnostic(value: unknown): boolean {
  return (
    record(value) &&
    boundedText(value.code, 64) &&
    boundedText(value.message, 2048) &&
    (value.file === undefined || (typeof value.file === 'string' && value.file.length <= 320)) &&
    (value.line === undefined || count(value.line)) &&
    (value.column === undefined || count(value.column))
  );
}

function isError(value: unknown): boolean {
  return (
    record(value) &&
    typeof value.code === 'string' &&
    ERROR_CODES.has(value.code) &&
    text(value.message) &&
    (value.code === 'layout_conflict' ? isRect(value.currentRect) : value.currentRect === undefined)
  );
}
