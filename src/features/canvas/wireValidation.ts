// The renderer's boundary for inbound Canvas events. The sidecar owns the
// authoritative schema; this checks the shape the projection relies on before
// any feature code can observe it.

import type { CanvasEvent } from './protocol';

const ERROR_CODES = new Set([
  'invalid_input',
  'revision_conflict',
  'invalid_source_path',
  'unsupported_import',
  'build_timeout',
  'capture_unavailable',
  'scope_expired',
  'storage_failed',
  'stale_revision',
  'stale_reference',
  'ambiguous_element',
  'invalid_edit',
  'invalid_source',
  'unsupported_edit',
  'not_found',
]);

const REPLY_KINDS = new Set([
  'ok',
  'summaries',
  'attachment',
  'created',
  'written',
  'arranged',
  'artifact',
  'revisions',
  'revisionDiff',
  'revisionFiles',
]);

/** An artifact document, bounded well above a realistic design (spec §5). */
const MAX_ARTIFACT_BYTES = 8 * 1024 * 1024;
const MAX_SOURCE_ELEMENTS = 8192;
const MAX_BUILD_DIAGNOSTICS = 64;
const MAX_SOURCE_FILE_BYTES = 256 * 1024;
const MAX_REVISION_PAGE_SIZE = 50;
const MAX_REVISION_DIFF_BYTES = 256 * 1024;
const MAX_DESIGN_SOURCE_BYTES = 1024 * 1024;
const utf8 = new TextEncoder();

export function isCanvasEvent(value: Record<string, unknown>): value is CanvasEvent {
  switch (value.type) {
    case 'canvas.summaries':
      return list(value.summaries, isSummary);
    case 'canvas.snapshot':
      return id(value.requestId) && isSnapshot(value.snapshot);
    case 'canvas.change':
      return isChange(value.change);
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
    case 'attachment':
      return value.canvasId === null || id(value.canvasId);
    case 'created':
      return (
        record(value.created) && id(value.created.canvasId) && list(value.created.frames, isFrame)
      );
    case 'written':
      return isReceipt(value.receipt);
    case 'arranged':
      return isChange(value.change);
    case 'artifact':
      return value.artifact === null || isArtifact(value.artifact);
    case 'revisions':
      return boundedList(value.revisions, MAX_REVISION_PAGE_SIZE, isRevisionSummary);
    case 'revisionDiff':
      return isRevisionDiff(value.diff);
    case 'revisionFiles':
      return isSourceFiles(value.files);
    default:
      return true;
  }
}

function isRevisionSummary(value: unknown): boolean {
  if (!record(value) || !record(value.author)) return false;
  return (
    id(value.revisionId) &&
    (value.restoredFromRevisionId === undefined || id(value.restoredFromRevisionId)) &&
    count(value.sequence) &&
    count(value.createdAt) &&
    (value.author.kind === 'user' ||
      (value.author.kind === 'agent' && id(value.author.scopeRef))) &&
    isDesignSystem(value.designSystem) &&
    typeof value.buildStatus === 'string' &&
    ['ready', 'failed', 'building'].includes(value.buildStatus) &&
    typeof value.mutationKind === 'string' &&
    ['create', 'write', 'edit', 'restore'].includes(value.mutationKind)
  );
}

function isRevisionDiff(value: unknown): boolean {
  if (!record(value) || !id(value.from) || !id(value.to) || typeof value.truncated !== 'boolean')
    return false;
  let bytes = 0;
  return boundedList(value.files, 128, (file) => {
    if (
      !record(file) ||
      !boundedText(file.path, 256) ||
      typeof file.diff !== 'string' ||
      typeof file.kind !== 'string' ||
      !['added', 'removed', 'modified'].includes(file.kind)
    )
      return false;
    if (file.diff.length > MAX_REVISION_DIFF_BYTES) return false;
    bytes += utf8.encode(file.diff).byteLength;
    return bytes <= MAX_REVISION_DIFF_BYTES;
  });
}

function isSourceFiles(value: unknown): boolean {
  if (!record(value)) return false;
  const files = Object.entries(value);
  if (files.length > 64) return false;
  let totalBytes = 0;
  return files.every(([path, source]) => {
    if (
      !boundedText(path, 256) ||
      typeof source !== 'string' ||
      source.length > MAX_SOURCE_FILE_BYTES
    )
      return false;
    const bytes = utf8.encode(source).byteLength;
    totalBytes += bytes;
    return bytes <= MAX_SOURCE_FILE_BYTES && totalBytes <= MAX_DESIGN_SOURCE_BYTES;
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

function isSnapshot(value: unknown): boolean {
  return (
    record(value) && id(value.canvasId) && count(value.sequence) && list(value.frames, isFrame)
  );
}

function isChange(value: unknown): boolean {
  return record(value) && isSnapshot(value) && list(value.removedDesignIds, id);
}

function isSummary(value: unknown): boolean {
  return (
    record(value) &&
    id(value.canvasId) &&
    text(value.name) &&
    count(value.updatedAt) &&
    count(value.designCount)
  );
}

function isReceipt(value: unknown): boolean {
  return record(value) && id(value.designId) && id(value.revisionId) && count(value.sequence);
}

function isFrame(value: unknown): boolean {
  return (
    record(value) &&
    id(value.designId) &&
    text(value.name) &&
    isRect(value.rect) &&
    count(value.layoutVersion) &&
    (value.revisionId === null || id(value.revisionId)) &&
    isDesignSystem(value.designSystem) &&
    isBuild(value.build)
  );
}

function isRect(value: unknown): boolean {
  return (
    record(value) &&
    finite(value.x) &&
    finite(value.y) &&
    finite(value.width) &&
    finite(value.height)
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
    text(value.message)
  );
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function list(value: unknown, entry: (item: unknown) => boolean): boolean {
  return Array.isArray(value) && value.every(entry);
}

function boundedList(value: unknown, max: number, entry: (item: unknown) => boolean): boolean {
  return Array.isArray(value) && value.length <= max && value.every(entry);
}

/** An opaque Canvas identifier, bounded the way the sidecar schema bounds it. */
function id(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= 128;
}

function text(value: unknown): boolean {
  return typeof value === 'string' && value.length > 0 && value.length <= 2_000;
}

function boundedText(value: unknown, max: number): boolean {
  return typeof value === 'string' && value.length > 0 && value.length <= max;
}

function count(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

function finite(value: unknown): boolean {
  return typeof value === 'number' && Number.isFinite(value);
}
