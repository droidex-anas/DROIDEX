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
    isSourceSpan(value.start, value.end, value.line) &&
    boundedText(value.tagName, MAX_SOURCE_FILE_BYTES) &&
    (value.component === null || boundedText(value.component, MAX_SOURCE_FILE_BYTES)) &&
    (value.editability === 'literal' ||
      value.editability === 'computed' ||
      value.editability === 'shared')
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
