// The renderer's boundary for inbound Canvas events. The sidecar owns the
// authoritative schema; this checks the shape the projection relies on before
// any feature code can observe it.

import type { CanvasEvent } from './protocol';

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
  'storage_failed',
]);

const REPLY_KINDS = new Set([
  'ok',
  'summaries',
  'attachment',
  'created',
  'written',
  'arranged',
  'artifact',
]);

/** An artifact document, bounded well above a realistic design (spec §5). */
const MAX_ARTIFACT_BYTES = 8 * 1024 * 1024;

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
    default:
      return true;
  }
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
      return id(value.revisionId) && id(value.artifactId);
    case 'failed':
      return (
        id(value.revisionId) &&
        list(value.diagnostics, isDiagnostic) &&
        (value.lastWorkingRevisionId === null || id(value.lastWorkingRevisionId))
      );
    case 'cancelled':
      return value.revisionId === null || id(value.revisionId);
    default:
      return false;
  }
}

function isDiagnostic(value: unknown): boolean {
  return (
    record(value) &&
    text(value.code) &&
    typeof value.message === 'string' &&
    (value.file === undefined || typeof value.file === 'string') &&
    (value.line === undefined || finite(value.line)) &&
    (value.column === undefined || finite(value.column))
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

/** An opaque Canvas identifier, bounded the way the sidecar schema bounds it. */
function id(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= 128;
}

function text(value: unknown): boolean {
  return typeof value === 'string' && value.length > 0 && value.length <= 2_000;
}

function count(value: unknown): boolean {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

function finite(value: unknown): boolean {
  return typeof value === 'number' && Number.isFinite(value);
}
