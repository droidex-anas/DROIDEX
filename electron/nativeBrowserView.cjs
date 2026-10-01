// Wires a bound <webview> guest into its browser entry: the page listeners that
// keep the entry's URL, history, console and load state current. The partition
// handlers stay as they were for views: permissions and devices are denied.
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
  listEntries,
}) {
  let browserSessionConfigured = false;

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
    ses.webRequest.onCompleted({ urls: ['http://*/*', 'https://*/*'] }, (details) => {
      recordNetworkEvent(details);
    });
    ses.webRequest.onErrorOccurred({ urls: ['http://*/*', 'https://*/*'] }, (details) => {
      recordNetworkEvent(details);
    });
    browserSessionConfigured = true;
  }

  function recordNetworkEvent(details) {
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
      error: details.error ? String(details.error).slice(0, 200) : undefined,
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
      failedRestoreUrl: null,
      state: { designMode: false, pencilMode: false },
      loadingUrl: null,
      loadingPromise: null,
      networkEvents: [],
      consoleEvents: [],
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
    contents.on('console-message', (details) => {
      entry.consoleEvents.push({
        timestamp: Date.now(),
        ...normalizeBrowserConsoleMessage(details),
      });
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
      if (!current() || urls.isChromeErrorUrl(loadedUrl)) return;
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
    contents.on('did-navigate-in-page', (_event, nextUrl) => {
      if (!current()) return;
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

module.exports = { createNativeBrowserViewFactory };
