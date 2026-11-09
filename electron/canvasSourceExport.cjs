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

function isRevision(input) {
  return (
    isCanvasId(input.canvasId) &&
    hasKeys(input.ref, ['designId', 'revisionId']) &&
    isCanvasId(input.ref.designId) &&
    isCanvasId(input.ref.revisionId)
  );
}

// An export to project names the chat and a folder inside its project; the
// sidecar finds the project folder and keeps the export inside it. Its request
// ID is what the renderer names to cancel it.
function isProjectExport(input) {
  return (
    hasKeys(input, ['canvasId', 'ref', 'project', 'requestId']) &&
    isRevision(input) &&
    isCanvasId(input.requestId) &&
    hasKeys(input.project, ['appSessionId', 'folder']) &&
    typeof input.project.appSessionId === 'string' &&
    input.project.appSessionId.length > 0 &&
    input.project.appSessionId.length <= 256 &&
    typeof input.project.folder === 'string' &&
    input.project.folder.length > 0 &&
    input.project.folder.length <= 1024
  );
}

function isExportRequest(input) {
  return (hasKeys(input, ['canvasId', 'ref']) && isRevision(input)) || isProjectExport(input);
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

const EXPORT_TIMEOUT_MS = 60_000;

function refusal(code, message) {
  return { ok: false, code, message };
}

// Main chooses the folder, then the sidecar's host-only route writes there; the
// renderer only ever names what to export, or for an export to project, the
// folder inside the chat's project. The answer is a result, never a throw, so a
// refusal reaches the renderer as its own message:
// { ok: true, filesWritten } | { ok: false, cancelled: true } | { ok: false, code, message }.
// `cancel(requestId)` aborts a running export to project; the sidecar sees its
// request go and removes its staging copy.
function createHostExport(host, { route, isRequest, invalidRequest, failed }) {
  const { chooseDirectory, getBridgeInfo, exportToken, fetchRequest } = host;
  const running = new Map();
  const run = async (input) => {
    if (!isRequest(input)) return refusal('invalid_input', invalidRequest);
    if (!isProjectExport(input)) {
      const result = await chooseDirectory();
      if (result.canceled || !result.filePaths[0]) return { ok: false, cancelled: true };
      const chosen = { ...input, destinationDirectory: result.filePaths[0] };
      return answerFor(chosen, new AbortController().signal);
    }
    const { requestId, ...body } = input;
    if (running.has(requestId)) return refusal('invalid_input', invalidRequest);
    const cancel = new AbortController();
    running.set(requestId, cancel);
    try {
      const answer = await answerFor(body, cancel.signal);
      return cancel.signal.aborted && !answer.ok ? { ok: false, cancelled: true } : answer;
    } finally {
      running.delete(requestId);
    }
  };
  const answerFor = async (body, cancelled) => {
    let port;
    try {
      ({ port } = await getBridgeInfo());
    } catch (error) {
      // The supervisor's own reason ("Sidecar is stopped.") is what the user can act on.
      console.error('Canvas export could not reach the sidecar:', error);
      return refusal(
        'storage_failed',
        error instanceof Error && error.message ? error.message : failed,
      );
    }
    let response;
    try {
      response = await fetchRequest(`http://127.0.0.1:${String(port)}${route}`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-canvas-export-token': exportToken(),
        },
        body: JSON.stringify(body),
        signal: AbortSignal.any([cancelled, AbortSignal.timeout(EXPORT_TIMEOUT_MS)]),
      });
    } catch (error) {
      if (!cancelled.aborted) console.error('Canvas export request failed:', error);
      const timedOut = error?.name === 'TimeoutError';
      return refusal(
        'storage_failed',
        timedOut ? 'The export did not finish within a minute. Try again.' : failed,
      );
    }
    if (response.status === 404)
      return refusal('storage_failed', 'Canvas export service changed. Try again.');
    let answer;
    try {
      answer = await response.json();
    } catch {
      return refusal(
        'storage_failed',
        'Canvas export service returned an invalid response. Try again.',
      );
    }
    if (!response.ok)
      return isExportError(answer)
        ? refusal(answer.code, answer.message)
        : refusal('storage_failed', failed);
    if (!isExportResult(answer))
      return refusal('storage_failed', 'Canvas export returned an invalid result. Try again.');
    return { ok: true, filesWritten: answer.filesWritten };
  };
  return Object.assign(run, {
    cancel: (requestId) => {
      running.get(requestId)?.abort();
    },
  });
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
