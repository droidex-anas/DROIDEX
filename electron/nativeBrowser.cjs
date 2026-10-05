const {
  normalizeBrowserConsoleMessage,
  redactBrowserDiagnosticUrl,
} = require('./browserDiagnostics.cjs');
const { createBrowserGuests } = require('./browserGuests.cjs');
const { runWithWebContentsDebugger } = require('./nativeBrowserEmulation.cjs');
const { createNativeBrowserUrlPolicy } = require('./nativeBrowserUrls.cjs');
const { createNativeBrowserCredentials } = require('./nativeBrowserCredentials.cjs');
const { createNativeBrowserPage } = require('./nativeBrowserPage.cjs');
const { createNativeBrowserViewFactory } = require('./nativeBrowserView.cjs');

// A single persistent partition keeps cookies, localStorage, and registered
// passkeys alive across reloads, dev-server restarts, and app restarts so the
// user does not have to sign in again every time.
const BROWSER_PARTITION = 'persist:droidex-browser';

// Pages live in <webview> guests the app renderer mounts and unmounts; main
// keeps one entry per browser session with the page's URL, history, logs and
// design state, and drives the guest bound to it. When the renderer unmounts a
// guest (or the app renderer reloads), the entry remembers its URL and the next
// guest bound to the session loads it again.
function createNativeBrowserManager(options) {
  const nativeBrowsers = new Map();
  const loadWaiters = new Map(); // browserSessionId -> Set<(loaded) => void>
  const urls = createNativeBrowserUrlPolicy({
    appName: options.appName,
    getHostAppUrl: options.getHostAppUrl,
  });
  const credentials = createNativeBrowserCredentials({
    app: options.app,
    appName: options.appName,
    safeStorage: options.safeStorage,
    dialog: options.dialog,
    getMainWindow: options.getMainWindow,
  });
  const guests = createBrowserGuests({
    partition: BROWSER_PARTITION,
    preloadPath: options.preloadPath,
    onBound: bindNativeBrowserGuest,
  });
  const views = createNativeBrowserViewFactory({
    session: options.session,
    partition: BROWSER_PARTITION,
    normalizeBrowserConsoleMessage,
    redactBrowserDiagnosticUrl,
    urls,
    loadUrl: loadNativeBrowserUrl,
    emitLoaded: emitNativeBrowserLoaded,
    emitLoadFailed: emitNativeBrowserLoadFailed,
    applyDesignState: (entry) => page.applyDesignState(entry),
    autofill: (contents) => credentials.autofill(contents),
    onCrashed: reportNativeBrowserCrash,
    onInput: options.onBrowserInput,
    listEntries: () => nativeBrowsers.values(),
  });
  const page = createNativeBrowserPage({
    appName: options.appName,
    ensureEntry: ensureNativeBrowserEntry,
    restoreForAction: requireLoadedGuest,
    liveContents,
    normalizeBrowserViewport: urls.normalizeBrowserViewport,
    credentials,
    runWithWebContentsDebugger,
    findEntryForContents: findNativeBrowserEntryForWebContents,
    nativeImage: options.nativeImage,
  });

  function ensureNativeBrowserEntry(browserSessionId) {
    browserSessionId = urls.normalizeNativeBrowserSessionId(browserSessionId);
    let entry = nativeBrowsers.get(browserSessionId);
    if (!entry) {
      entry = views.createEntry(browserSessionId);
      nativeBrowsers.set(browserSessionId, entry);
    }
    return entry;
  }

  function liveContents(entry) {
    const contents = entry?.contents;
    return contents && !contents.isDestroyed() ? contents : undefined;
  }

  // The renderer asks for a guest before it mounts one; the token it gets back
  // is the only way that guest can attach. After an app restart main knows no
  // URL for the page, so the one the renderer saved is restored, if allowed.
  function reserveNativeBrowser(browserSessionId, host, savedUrl) {
    const entry = ensureNativeBrowserEntry(browserSessionId);
    if (!entry.targetUrl && savedUrl && isAllowedUrl(savedUrl)) entry.targetUrl = savedUrl;
    return guests.reserve(entry.browserSessionId, host);
  }

  function isAllowedUrl(url) {
    try {
      urls.rejectHostAppUrl(url);
      urls.validateUrl(url);
      return true;
    } catch {
      return false;
    }
  }

  function releaseNativeBrowser(browserSessionId) {
    const entry = nativeBrowsers.get(urls.normalizeNativeBrowserSessionId(browserSessionId));
    if (!entry) return;
    guests.release(entry.browserSessionId);
    entry.contents = null;
    entry.shown = false;
    forgetLoad(entry);
    forgetLoadWaiters(entry);
  }

  function bindNativeBrowserGuest(browserSessionId, contents) {
    const entry = ensureNativeBrowserEntry(browserSessionId);
    forgetLoad(entry);
    forgetLoadWaiters(entry);
    views.bindGuest(entry, contents);
    const restoreUrl = urls.restorableUrlForEntry(entry, entry.targetUrl);
    if (restoreUrl) void loadNativeBrowserUrl(entry, restoreUrl, { force: true });
  }

  // A load belongs to the guest that started it; a new guest starts afresh.
  function forgetLoad(entry) {
    entry.loadingUrl = null;
    entry.loadingPromise = null;
  }

  // Nobody waiting on a guest's next load hears about its replacement's loads.
  function forgetLoadWaiters(entry) {
    for (const settle of [...(loadWaiters.get(entry.browserSessionId) ?? [])]) settle(undefined);
  }

  async function waitForGuest(browserSessionId) {
    const entry = ensureNativeBrowserEntry(browserSessionId);
    if (!liveContents(entry)) await guests.waitForGuest(entry.browserSessionId);
    return entry;
  }

  function rejectCrashed(entry) {
    if (entry.crashed) throw new Error(`The ${options.appName} browser page crashed. Reload it.`);
    return entry;
  }

  async function requireNativeBrowserGuest(browserSessionId) {
    return rejectCrashed(await waitForGuest(browserSessionId));
  }

  // Page actions run against the restored page, not the blank one before it.
  // A failed load can start a retry before it settles, so wait for the
  // current one until none is left.
  async function waitForLoadedGuest(browserSessionId) {
    const entry = await waitForGuest(browserSessionId);
    while (entry.loadingPromise) await entry.loadingPromise;
    return entry;
  }

  async function requireLoadedGuest(browserSessionId) {
    return rejectCrashed(await waitForLoadedGuest(browserSessionId));
  }

  async function openNativeBrowser(browserSessionId, url, viewport) {
    const entry = await requireNativeBrowserGuest(browserSessionId);
    if (viewport) entry.viewport = urls.normalizeBrowserViewport(viewport);
    urls.rejectHostAppUrl(url);
    url = urls.normalizeNativeBrowserUrl(entry, url);
    urls.validateUrl(url);
    entry.failedRestoreUrl = null;
    await loadNativeBrowserUrl(entry, url, { force: true });
  }

  function setNativeBrowserShown(browserSessionId, shown) {
    const entry = ensureNativeBrowserEntry(browserSessionId);
    if (entry.shown === Boolean(shown)) return;
    entry.shown = Boolean(shown);
    if (entry.state.designMode) void page.applyDesignState(entry);
  }

  function closeNativeBrowser(browserSessionId) {
    const entry = nativeBrowsers.get(urls.normalizeNativeBrowserSessionId(browserSessionId));
    if (!entry) return;
    guests.release(entry.browserSessionId);
    nativeBrowsers.delete(entry.browserSessionId);
  }

  // Reload never waits for a load: it is how a stalled, failed or crashed page
  // recovers. A load still in flight or a failed restore starts over.
  async function reloadNativeBrowser(browserSessionId) {
    const entry = await waitForGuest(browserSessionId);
    const contents = liveContents(entry);
    if (!contents) throw new Error(`${options.appName} browser is not open.`);
    const pendingUrl = entry.loadingUrl === entry.targetUrl ? entry.loadingUrl : null;
    const retryUrl = entry.failedRestoreUrl ?? pendingUrl;
    if (retryUrl) {
      entry.failedRestoreUrl = null;
      forgetLoad(entry);
      return loadNativeBrowserUrl(entry, retryUrl, { force: true });
    }
    entry.crashed = false;
    if (contents.getURL()) entry.targetUrl = contents.getURL();
    contents.reload();
  }

  // `before` runs right before the page moves.
  async function navigateNativeBrowserHistory(browserSessionId, direction, before) {
    const entry = await requireLoadedGuest(browserSessionId);
    const contents = liveContents(entry);
    if (!contents) throw new Error(`${options.appName} browser is not open.`);
    const history = contents.navigationHistory;
    if (!history) return false;
    if (direction === 'back') {
      if (!history.canGoBack()) return false;
      before?.();
      history.goBack();
    } else {
      if (!history.canGoForward()) return false;
      before?.();
      history.goForward();
    }
    return true;
  }

  // Reload with a browser page focused reloads that page, never the app shell,
  // which would destroy every mounted page.
  function reloadFocusedNativeBrowser(focusedContents) {
    const browserSessionId = focusedContents && guests.sessionIdFor(focusedContents);
    if (!browserSessionId) return false;
    void reloadNativeBrowser(browserSessionId).catch(() => undefined);
    return true;
  }

  function findNativeBrowserEntryForWebContents(contents) {
    const browserSessionId = guests.sessionIdFor(contents);
    return browserSessionId ? nativeBrowsers.get(browserSessionId) : undefined;
  }

  function emitNativeBrowserLoaded(entry, url) {
    const history = liveContents(entry)?.navigationHistory;
    const event = {
      browserSessionId: entry.browserSessionId,
      url,
      canGoBack: history?.canGoBack() ?? false,
      canGoForward: history?.canGoForward() ?? false,
    };
    options.sendToRenderer('native-browser-loaded', event);
    for (const settle of [...(loadWaiters.get(entry.browserSessionId) ?? [])]) settle(event);
  }

  // The next page load in a session, or undefined once `timeoutMs` passes.
  function nextNativeBrowserLoad(browserSessionId, timeoutMs) {
    const id = urls.normalizeNativeBrowserSessionId(browserSessionId);
    return new Promise((resolve) => {
      const waiters = loadWaiters.get(id) ?? new Set();
      loadWaiters.set(id, waiters);
      const timer = setTimeout(() => settle(undefined), timeoutMs);
      function settle(event) {
        clearTimeout(timer);
        waiters.delete(settle);
        if (waiters.size === 0 && loadWaiters.get(id) === waiters) loadWaiters.delete(id);
        resolve(event);
      }
      waiters.add(settle);
    });
  }

  function emitNativeBrowserLoadFailed(entry, url, error, crashed = false) {
    options.sendToRenderer('native-browser-load-failed', {
      browserSessionId: entry.browserSessionId,
      url,
      error,
      crashed,
    });
  }

  function reportNativeBrowserCrash(entry, details) {
    const reason = String(details?.reason || 'unknown');
    if (reason === 'clean-exit') return;
    console.error(
      `Browser page exited: browserSession=${entry.browserSessionId} reason=${reason} exitCode=${details?.exitCode}`,
    );
    emitNativeBrowserLoadFailed(
      entry,
      urls.restorableUrlForEntry(entry, entry.targetUrl) ?? 'about:blank',
      reason,
      true,
    );
  }

  async function loadNativeBrowserUrl(entry, url, loadOptions = {}) {
    url = urls.normalizeNativeBrowserUrl(entry, url);
    const contents = liveContents(entry);
    if (!contents) return { ok: false };
    if (url === 'about:blank' && contents.getURL() === 'about:blank') return { ok: true };
    if (!loadOptions.force && contents.getURL() === url) return { ok: true };
    if (entry.loadingUrl === url && entry.loadingPromise) return entry.loadingPromise;
    entry.targetUrl = url;
    const load = contents
      .loadURL(url)
      .then(() => {
        if (liveContents(entry) !== contents || urls.isChromeErrorUrl(contents.getURL()))
          return { ok: false };
        return { ok: true };
      })
      .catch((err) => {
        // Only the current load may forget its URL; a superseded one was aborted.
        if (entry.loadingPromise === load && entry.targetUrl === url) entry.targetUrl = null;
        if (!contents.isDestroyed() && !urls.isLoadAbortError(err))
          console.error(`failed to load browser URL: ${err.message}`);
        return { ok: false, error: err };
      })
      .finally(() => {
        if (entry.loadingPromise === load) {
          entry.loadingPromise = null;
          entry.loadingUrl = null;
        }
      });
    entry.loadingUrl = url;
    entry.loadingPromise = load;
    return load;
  }

  function closeAllNativeBrowsers() {
    for (const entry of nativeBrowsers.values()) guests.release(entry.browserSessionId);
    nativeBrowsers.clear();
  }

  function withNativeBrowserSession(event, payload) {
    return { ...payload, browserSessionId: guests.sessionIdFor(event.sender) };
  }

  return {
    reserve: reserveNativeBrowser,
    release: releaseNativeBrowser,
    handleWillAttach: guests.handleWillAttach,
    handleCreated: guests.handleCreated,
    handleAttached: guests.handleAttached,
    open: openNativeBrowser,
    setShown: setNativeBrowserShown,
    close: closeNativeBrowser,
    reload: reloadNativeBrowser,
    reloadFocused: reloadFocusedNativeBrowser,
    waitForPage: waitForGuest,
    nextLoad: nextNativeBrowserLoad,
    goBack: (browserSessionId, before) =>
      navigateNativeBrowserHistory(browserSessionId, 'back', before),
    goForward: (browserSessionId, before) =>
      navigateNativeBrowserHistory(browserSessionId, 'forward', before),
    setDesignMode: page.setDesignMode,
    setPencilMode: page.setPencilMode,
    runAgentAction: page.runAgentAction,
    waitForPaint: page.waitForPaint,
    abandonWork: (browserSessionId) => {
      const entry = nativeBrowsers.get(urls.normalizeNativeBrowserSessionId(browserSessionId));
      const contents = liveContents(entry);
      if (contents) page.abandonOperations(contents);
    },
    capture: page.capture,
    captureDesignSelection: page.captureDesignSelection,
    handleCredentialCapture: credentials.handleCapture,
    sessionIdForWebContents: guests.sessionIdFor,
    withSession: withNativeBrowserSession,
    closeAll: closeAllNativeBrowsers,
    resourceCounts: () => {
      const live = [...nativeBrowsers.values()].filter((entry) => liveContents(entry)).length;
      return { live, sessions: nativeBrowsers.size };
    },
  };
}

module.exports = { createNativeBrowserManager, BROWSER_PARTITION };
