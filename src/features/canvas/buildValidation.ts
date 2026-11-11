// The renderer's checks of a frame's build state and the diagnostics a build
// reports, bounded as the sidecar's schema bounds them.

import { boundedList, boundedText, count, id, record } from './wireChecks';

const MAX_SOURCE_ELEMENTS = 8192;
export const MAX_BUILD_DIAGNOSTICS = 64;
export const MAX_SOURCE_FILE_BYTES = 256 * 1024;

export function isBuild(value: unknown): boolean {
  // Every state names the attempt it belongs to, whatever the attempt produced.
  if (!record(value) || !count(value.generation)) return false;
  switch (value.status) {
    case 'pending':
      return true;
    case 'building':
      return id(value.revisionId);
    case 'ready':
      return isReadyBuild(value);
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

function isReadyBuild(value: Record<string, unknown>): boolean {
  return (
    id(value.revisionId) &&
    id(value.artifactId) &&
    boundedList(value.elements, MAX_SOURCE_ELEMENTS, isSourceElement) &&
    isOutline(value.outline) &&
    boundedList(value.diagnostics, MAX_BUILD_DIAGNOSTICS, isDiagnostic)
  );
}

function isSourceElement(value: unknown): boolean {
  return (
    record(value) &&
    id(value.elementId) &&
    boundedText(value.file, 256) &&
    isSourceSpan(value.start, value.end, value.line) &&
    boundedText(value.tagName, MAX_SOURCE_FILE_BYTES) &&
    (value.component === null || boundedText(value.component, MAX_SOURCE_FILE_BYTES)) &&
    (value.editability === 'literal' ||
      value.editability === 'computed' ||
      value.editability === 'shared')
  );
}

const OUTLINE_KINDS = new Set(['element', 'instance', 'repeat', 'condition']);
const OUTLINE_LOCKS = new Set(['repeated', 'shared', 'computed', 'kit']);

const MAX_OUTLINE_LABEL_CODE_POINTS = 64;

/** Rows with unique ids, each after the row that holds it, so they form a tree with no cycle. */
function isOutline(value: unknown): boolean {
  if (!record(value) || typeof value.truncated !== 'boolean') return false;
  if (!boundedList(value.nodes, MAX_SOURCE_ELEMENTS, isOutlineNode)) return false;
  const seen = new Set<unknown>();
  for (const { nodeId, parentId } of value.nodes as Record<string, unknown>[]) {
    if (seen.has(nodeId) || (parentId !== null && !seen.has(parentId))) return false;
    seen.add(nodeId);
  }
  return true;
}

function isOutlineNode(value: unknown): boolean {
  return (
    record(value) &&
    isOutlineNodeId(value.nodeId) &&
    (value.parentId === null || isOutlineNodeId(value.parentId)) &&
    OUTLINE_KINDS.has(value.kind as string) &&
    isOutlineLabel(value.name) &&
    (value.text === null || (value.kind === 'element' && isOutlineLabel(value.text))) &&
    (value.kind === 'element' ? id(value.elementId) : value.elementId === null) &&
    (value.lock === null || OUTLINE_LOCKS.has(value.lock as string)) &&
    typeof value.free === 'boolean' &&
    typeof value.contentFromProps === 'boolean'
  );
}

export function isOutlineNodeId(value: unknown): boolean {
  return typeof value === 'string' && /^[0-9a-f]{16}$/.test(value);
}

/** A row's name or text: one line of at most 64 code points, each at most two UTF-16 units. */
function isOutlineLabel(value: unknown): boolean {
  return (
    typeof value === 'string' &&
    boundedText(value, MAX_OUTLINE_LABEL_CODE_POINTS * 2) &&
    !/[\r\n]/.test(value) &&
    Array.from(value).length <= MAX_OUTLINE_LABEL_CODE_POINTS
  );
}

/** An element's offsets and the 1-based line it starts on, all within one source file. */
function isSourceSpan(start: unknown, end: unknown, line: unknown): boolean {
  return (
    count(start) &&
    count(end) &&
    end > start &&
    end <= MAX_SOURCE_FILE_BYTES &&
    count(line) &&
    line > 0 &&
    line <= MAX_SOURCE_FILE_BYTES
  );
}

export function isDiagnostic(value: unknown): boolean {
  return (
    record(value) &&
    boundedText(value.code, 64) &&
    boundedText(value.message, 2048) &&
    (value.file === undefined || (typeof value.file === 'string' && value.file.length <= 320)) &&
    (value.line === undefined || count(value.line)) &&
    (value.column === undefined || count(value.column))
  );
}
