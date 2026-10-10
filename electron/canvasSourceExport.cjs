const CANVAS_ID = /^[A-Za-z0-9_-]{1,128}$/;
const ERROR_CODES = new Set([
  'invalid_input',
  'revision_conflict',
  'invalid_source_path',
  'unsupported_import',
  'build_timeout',
  'capture_unavailable',
  'scope_expired',
  'storage_failed',
  'version_mismatch',
]);

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function hasKeys(value, keys) {
  return (
    isRecord(value) &&
    Object.keys(value).length === keys.length &&
    keys.every((key) => Object.hasOwn(value, key))
  );
}

function isCanvasId(value) {
  return typeof value === 'string' && CANVAS_ID.test(value);
}

function isExportRequest(input) {
  return (
    hasKeys(input, ['canvasId', 'ref']) &&
    isCanvasId(input.canvasId) &&
    hasKeys(input.ref, ['designId', 'revisionId']) &&
    isCanvasId(input.ref.designId) &&
    isCanvasId(input.ref.revisionId)
  );
}

function isDesignSystemExportRequest(input) {
  return (
    hasKeys(input, ['ref']) &&
    hasKeys(input.ref, ['id', 'version']) &&
    isCanvasId(input.ref.id) &&
    Number.isSafeInteger(input.ref.version) &&
    input.ref.version >= 0
  );
}

function isExportResult(answer) {
  return (
    hasKeys(answer, ['filesWritten']) &&
    Number.isSafeInteger(answer.filesWritten) &&
    answer.filesWritten >= 0
  );
}

function isExportError(answer) {
  return (
    hasKeys(answer, ['code', 'message']) &&
    ERROR_CODES.has(answer.code) &&
    typeof answer.message === 'string' &&
    answer.message.length > 0 &&
    answer.message.length <= 500
  );
}

// Main chooses the folder, then the sidecar's host-only route writes there; the
// renderer only ever names what to export.
function createHostExport(host, { route, isRequest, invalidRequest, failed }) {
  const { chooseDirectory, getBridgeInfo, exportToken, fetchRequest } = host;
  return async (input) => {
    if (!isRequest(input)) throw new Error(invalidRequest);
    const result = await chooseDirectory();
    if (result.canceled || !result.filePaths[0]) return null;
    const { port } = await getBridgeInfo();
    const response = await fetchRequest(`http://127.0.0.1:${String(port)}${route}`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-canvas-export-token': exportToken(),
      },
      body: JSON.stringify({ ...input, destinationDirectory: result.filePaths[0] }),
      signal: AbortSignal.timeout(60_000),
    });
    if (response.status === 404) throw new Error('Canvas export service changed. Try again.');
    let answer;
    try {
      answer = await response.json();
    } catch {
      throw new Error('Canvas export service returned an invalid response. Try again.');
    }
    if (!response.ok) throw new Error(isExportError(answer) ? answer.message : failed);
    if (!isExportResult(answer))
      throw new Error('Canvas export returned an invalid result. Try again.');
    return answer;
  };
}

function createCanvasSourceExport(host) {
  return createHostExport(host, {
    route: '/canvas/source-export',
    isRequest: isExportRequest,
    invalidRequest: 'Choose a Canvas revision to export.',
    failed: 'Canvas source could not be exported.',
  });
}

function createDesignSystemExport(host) {
  return createHostExport(host, {
    route: '/canvas/design-system-export',
    isRequest: isDesignSystemExportRequest,
    invalidRequest: 'Choose a design system to export.',
    failed: 'The design system could not be exported.',
  });
}

module.exports = { createCanvasSourceExport, createDesignSystemExport };
