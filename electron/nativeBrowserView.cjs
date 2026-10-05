// Wires a bound <webview> guest into its browser entry: the page listeners that
// keep the entry's URL, history, console and load state current. The partition
// handlers stay as they were for views: permissions and devices are denied.
const { CONSOLE_LEVELS } = require('./browserDiagnostics.cjs');

function createNativeBrowserViewFactory({
  session,
  partition,
  normalizeBrowserConsoleMessage,
  redactBrowserDiagnosticUrl,
  urls,
  loadUrl,
  emitLoaded,
  emitLoadFailed,
  applyDesignState,
  autofill,
  onCrashed,
  onInput,
  listEntries,
}) {
  let browserSessionConfigured = false;
  const requestStarts = new Map(); // webRequest id -> when its headers went out

  function configureSession() {
    if (browserSessionConfigured) return;
    const ses = session.fromPartition(partition);
    // Keep Electron's safe defaults: deny WebHID/WebUSB device access for the
    // embedded browser. WebAuthn / passkeys are handled by Chromium natively and
    // do not flow through these handlers, so granting HID/USB to arbitrary sites
    // (and auto-selecting a device) would only open a hardware-permission
    // escalation path with no upside.
    ses.setDevicePermissionHandler(() => false);
    ses.setPermissionCheckHandler(() => false);
    ses.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false));
    const pages = { urls: ['http://*/*', 'https://*/*'] };
    // When each request went out, for how long it took. One that never ends
    // would stay here, so the lot is dropped once it grows past any real page.
    ses.webRequest.onSendHeaders(pages, (details) => {
      if (requestStarts.size >= 500) requestStarts.clear();
      requestStarts.set(details.id, details.timestamp);
    });
    ses.webRequest.onCompleted(pages, recordNetworkEvent);
    ses.webRequest.onErrorOccurred(pages, recordNetworkEvent);
    browserSessionConfigured = true;
  }

  function recordNetworkEvent(details) {
    const startedAt = requestStarts.get(details.id);
    requestStarts.delete(details.id);
    const entry = [...listEntries()].find(
      (candidate) => candidate.contents?.id === details.webContentsId,
    );
    if (!entry) return;
    entry.networkEvents.push({
      timestamp: Date.now(),
      method: String(details.method || 'GET').slice(0, 16),
      url: redactBrowserDiagnosticUrl(details.url),
      resourceType: details.resourceType ? String(details.resourceType) : undefined,
      status: Number.isFinite(details.statusCode) ? details.statusCode : undefined,
      // A request that completed carries "net::OK" here.
      error:
        details.error && details.error !== 'net::OK'
          ? String(details.error).slice(0, 200)
          : undefined,
      durationMs: startedAt === undefined ? undefined : Math.round(details.timestamp - startedAt),
      bytes: contentLength(details.responseHeaders),
      cached: details.fromCache || undefined,
    });
    if (entry.networkEvents.length > 100) {
      entry.networkEvents.splice(0, entry.networkEvents.length - 100);
    }
  }

  function createEntry(browserSessionId) {
    return {
      browserSessionId,
      contents: null,
      crashed: false,
      shown: false,
      targetUrl: null,
      setup: null,
      failedRestoreUrl: null,
      state: { designMode: false, pencilMode: false },
      loadingUrl: null,
      loadingPromise: null,
      networkEvents: [],
      consoleEvents: [],
      errorTimes: [],
    };
  }

  function bindGuest(entry, contents) {
    configureSession();
    entry.contents = contents;
    entry.crashed = false;
    const current = () => entry.contents === contents && !contents.isDestroyed();
    contents.setWindowOpenHandler(({ url: nextUrl }) => {
      if (current()) void loadUrl(entry, nextUrl);
      return { action: 'deny' };
    });
    contents.on('before-input-event', onInput);
    contents.on('console-message', (details) => {
      // Electron's own notices about the guest are not the page's.
      if (!current() || String(details.sourceId ?? '').startsWith('node:electron/')) return;
      const message = normalizeBrowserConsoleMessage(details);
      // When errors came in, kept apart from the log, which a read empties.
      if (message.level === CONSOLE_LEVELS.error) {
        entry.errorTimes.push(Date.now());
        if (entry.errorTimes.length > 100) entry.errorTimes.shift();
      }
      entry.consoleEvents.push({ timestamp: Date.now(), ...message });
      if (entry.consoleEvents.length > 100) {
        entry.consoleEvents.splice(0, entry.consoleEvents.length - 100);
      }
    });
    contents.on('will-navigate', (_event, requestedUrl) => {
      if (!current()) return;
      // Page and user navigations only; main's own loadURL calls do not emit it.
      entry.failedRestoreUrl = null;
      entry.targetUrl = requestedUrl;
    });
    contents.on('did-navigate', (_event, loadedUrl) => {
      // The blank page a guest is set up on is not the browser's page.
      if (entry.setup?.contents === contents && loadedUrl === 'about:blank') return;
      if (!current() || urls.isChromeErrorUrl(loadedUrl)) return;
      // Nor is it part of the browser's history: it goes once a page follows it.
      const history = contents.navigationHistory;
      if (history.getActiveIndex() === 1 && history.getEntryAtIndex(0)?.url === 'about:blank')
        history.removeEntryAtIndex(0);
      entry.failedRestoreUrl = null;
      entry.targetUrl = loadedUrl;
      emitLoaded(entry, loadedUrl);
    });
    contents.on('did-finish-load', () => {
      if (!current()) return;
      const loadedUrl = contents.getURL();
      if (urls.isChromeErrorUrl(loadedUrl)) {
        if (entry.targetUrl && !urls.isChromeErrorUrl(entry.targetUrl))
          emitLoaded(entry, entry.targetUrl);
        return;
      }
      if (entry.state.designMode && entry.shown) applyDesignState(entry);
      void autofill(contents);
    });
    contents.on('did-fail-load', (_event, errorCode, errorDescription, failedUrl, isMainFrame) => {
      if (!current() || !isMainFrame || errorCode === -3) return;
      const fallback = urls.httpFallbackUrl(failedUrl, errorCode);
      if (fallback) {
        urls.rememberFailedRestoreUrl(entry, entry.targetUrl || failedUrl);
        void loadUrl(entry, fallback, { force: true });
        return;
      }
      urls.rememberFailedRestoreUrl(entry, entry.targetUrl || failedUrl);
      emitLoadFailed(entry, failedUrl, errorDescription || `net error ${errorCode}`);
    });
    contents.on('dom-ready', () => {
      if (current() && entry.state.designMode && entry.shown) applyDesignState(entry);
    });
    // A frame's hash change or pushState is not the page moving.
    contents.on('did-navigate-in-page', (_event, nextUrl, isMainFrame) => {
      if (!current() || !isMainFrame) return;
      entry.targetUrl = nextUrl;
      emitLoaded(entry, nextUrl);
      if (entry.state.designMode && entry.shown) applyDesignState(entry);
    });
    contents.on('render-process-gone', (_event, details) => {
      if (entry.contents !== contents || details?.reason === 'clean-exit') return;
      entry.crashed = true;
      entry.loadingUrl = null;
      entry.loadingPromise = null;
      onCrashed(entry, details);
    });
    contents.once('destroyed', () => {
      if (entry.contents === contents) entry.contents = null;
    });
  }

  return { bindGuest, configureSession, createEntry };
}

// The size the server states for a response; many state none.
function contentLength(headers) {
  const name = Object.keys(headers ?? {}).find((key) => key.toLowerCase() === 'content-length');
  const bytes = name ? Number(headers[name][0]) : NaN;
  return Number.isFinite(bytes) ? bytes : undefined;
}

module.exports = { createNativeBrowserViewFactory };
