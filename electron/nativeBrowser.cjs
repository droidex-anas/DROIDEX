const {
  normalizeBrowserConsoleMessage,
  redactBrowserDiagnosticUrl,
} = require('./browserDiagnostics.cjs');
const { createBrowserGuests } = require('./browserGuests.cjs');
const { runWithWebContentsDebugger } = require('./nativeBrowserEmulation.cjs');
const { mountDevice } = require('./browserDevice.cjs');
const { createNativeBrowserUrlPolicy } = require('./nativeBrowserUrls.cjs');
const { createNativeBrowserCredentials } = require('./nativeBrowserCredentials.cjs');
const { createBrowserDevTools } = require('./browserDevTools.cjs');
const { createBrowserPreview } = require('./browserPreview.cjs');
const { createNativeBrowserPage } = require('./nativeBrowserPage.cjs');
const { createNativeBrowserViewFactory } = require('./nativeBrowserView.cjs');

// A single persistent partition keeps cookies, localStorage, and registered
// passkeys alive across reloads, dev-server restarts, and app restarts so the
// user does not have to sign in again every time.
const BROWSER_PARTITION = 'persist:droidex-browser';
const VIEWPORT_MODES = ['fit', 'desktop', 'laptop', 'tablet', 'mobile'];

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
    showPrompt: options.showPrompt,
  });
  const guests = createBrowserGuests({
    partition: BROWSER_PARTITION,
    preloadPath: options.preloadPath,
    onBound: bindNativeBrowserGuest,
  });
  const views = createNativeBrowserViewFactory({
    session: options.session,
    partition: BROWSER_PARTITION,
    permissions: options.permissions,
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
  const devTools = createBrowserDevTools({
    appName: options.appName,
    showPrompt: options.showPrompt,
    isHostAppUrl: urls.isHostAppUrl,
    runWithWebContentsDebugger,
  });
  const page = createNativeBrowserPage({
    appName: options.appName,
    ensureEntry: ensureNativeBrowserEntry,
    restoreForAction: requireLoadedGuest,
    liveContents,
    credentials,
    devTools,
    runWithWebContentsDebugger,
    sendToRenderer: options.sendToRenderer,
    findEntryForContents: findNativeBrowserEntryForWebContents,
    nativeImage: options.nativeImage,
  });

  const preview = createBrowserPreview({
    liveContentsOf: (browserSessionId) => liveContents(nativeBrowsers.get(browserSessionId)),
    runWithWebContentsDebugger,
    sendToRenderer: options.sendToRenderer,
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
  // URL or size for the page, so the ones the renderer saved are taken up
  // again: the URL if allowed, the size's name for the device it asks for.
  function reserveNativeBrowser(browserSessionId, host, savedUrl, savedMode) {
    const entry = ensureNativeBrowserEntry(browserSessionId);
    if (!entry.targetUrl && savedUrl && isAllowedUrl(savedUrl)) entry.targetUrl = savedUrl;
    if (!entry.viewportMode && VIEWPORT_MODES.includes(savedMode)) entry.viewportMode = savedMode;
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
    options.permissions.revokeForContents(entry.contents);
    guests.release(entry.browserSessionId);
    entry.contents = null;
    preview.sync(entry.browserSessionId);
    entry.shown = false;
    forgetLoad(entry);
    forgetLoadWaiters(entry);
  }

  function bindNativeBrowserGuest(browserSessionId, contents) {
    const entry = ensureNativeBrowserEntry(browserSessionId);
    forgetLoad(entry);
    forgetLoadWaiters(entry);
    const restoreUrl = urls.restorableUrlForEntry(entry, entry.targetUrl);
    views.bindGuest(entry, contents);
    preview.sync(entry.browserSessionId);
    // The device first, so a site sees it from its first request and script.
    // Until the guest has it the entry counts as loading, an open waits for it
    // and takes the saved page's place, and the blank page a touch device is
    // set up on is not reported as the browser's page.
    const setup = { contents, restoreUrl, ready: mountDevice(contents, entry) };
    entry.setup = setup;
    const restored = setup.ready.then(() => {
      if (entry.setup === setup) entry.setup = null;
      // A load started meanwhile is the page now; otherwise the saved one returns.
      if (entry.loadingPromise !== restored) return undefined;
      entry.loadingPromise = null;
      if (setup.restoreUrl && liveContents(entry) === contents)
        return loadNativeBrowserUrl(entry, setup.restoreUrl, { force: true });
      return undefined;
    });
    entry.loadingPromise = restored;
  }

  // A load belongs to the guest that started it; a new guest starts afresh.
  function forgetLoad(entry) {
    entry.loadingUrl = null;
    entry.loadingPromise = null;
    entry.setup = null;
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
  // current one until none is left. The browser may have been closed meanwhile.
  async function waitForLoadedGuest(browserSessionId) {
    const entry = await waitForGuest(browserSessionId);
    while (entry.loadingPromise) await entry.loadingPromise;
    if (nativeBrowsers.get(entry.browserSessionId) !== entry)
      throw new Error(`${options.appName} browser is not open.`);
    return entry;
  }

  async function requireLoadedGuest(browserSessionId) {
    return rejectCrashed(await waitForLoadedGuest(browserSessionId));
  }

  // Resolves once no guest of the entry is still taking its device. With
  // `replacing`, the saved page gives way to what the caller loads next.
  async function deviceReady(entry, replacing = false) {
    while (entry.setup) {
      const { setup } = entry;
      if (replacing) setup.restoreUrl = null;
      await setup.ready;
      if (entry.setup === setup) entry.setup = null;
    }
  }

  // `before` runs right before the page moves, and throws when it should not.
  async function openNativeBrowser(browserSessionId, url, before) {
    const entry = await requireNativeBrowserGuest(browserSessionId);
    urls.rejectHostAppUrl(url);
    url = urls.normalizeNativeBrowserUrl(entry, url);
    urls.validateUrl(url);
    entry.failedRestoreUrl = null;
    // A guest still taking its device loads this page once it has it, in place
    // of its saved one. The browser may have been closed, or the caller have
    // given up, while this waited.
    await deviceReady(entry, true);
    if (nativeBrowsers.get(entry.browserSessionId) !== entry)
      throw new Error(`${options.appName} browser is not open.`);
    before?.();
    await loadNativeBrowserUrl(entry, url, { force: true });
  }

  // Only an open browser is shown or hidden: the renderer hides a page it
  // closes after main has already forgotten it.
  function setNativeBrowserShown(browserSessionId, shown) {
    const entry = nativeBrowsers.get(urls.normalizeNativeBrowserSessionId(browserSessionId));
    if (!entry || entry.shown === Boolean(shown)) return;
    entry.shown = Boolean(shown);
    if (entry.state.designMode) void page.applyDesignState(entry);
  }

  function closeNativeBrowser(browserSessionId) {
    const entry = nativeBrowsers.get(urls.normalizeNativeBrowserSessionId(browserSessionId));
    if (!entry) return;
    options.permissions.revokeForContents(entry.contents);
    // A restore still waiting on the guest's setup never runs, and an action
    // still waiting on the page never reaches it.
    forgetLoad(entry);
    preview.watch(entry.browserSessionId, false);
    guests.release(entry.browserSessionId);
    entry.contents = null;
    nativeBrowsers.delete(entry.browserSessionId);
  }

  // Reload never waits for a load: it is how a stalled, failed or crashed page
  // recovers. A load still in flight or a failed restore starts over. `before`
  // runs right before the page moves, and throws when it should not.
  async function reloadNativeBrowser(browserSessionId, before) {
    const entry = await waitForGuest(browserSessionId);
    // A guest still taking its device finishes that first, so the page is asked
    // for as that device. The browser may have been closed meanwhile.
    await deviceReady(entry);
    const contents = nativeBrowsers.get(entry.browserSessionId) === entry && liveContents(entry);
    if (!contents) throw new Error(`${options.appName} browser is not open.`);
    before?.();
    entry.crashed = false;
    const pendingUrl = entry.loadingUrl === entry.targetUrl ? entry.loadingUrl : null;
    const retryUrl = entry.failedRestoreUrl ?? pendingUrl;
    if (retryUrl) {
      entry.failedRestoreUrl = null;
      forgetLoad(entry);
      return loadNativeBrowserUrl(entry, retryUrl, { force: true });
    }
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
    options.permissions.revokeAll();
    preview.forget();
    for (const entry of nativeBrowsers.values()) {
      forgetLoad(entry);
      guests.release(entry.browserSessionId);
    }
    nativeBrowsers.clear();
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
    setDesignState: page.setDesignState,
    runAgentAction: page.runAgentAction,
    waitForPaint: page.waitForPaint,
    abandonWork: (browserSessionId) => {
      const entry = nativeBrowsers.get(urls.normalizeNativeBrowserSessionId(browserSessionId));
      const contents = liveContents(entry);
      if (contents) page.abandonOperations(contents);
    },
    watch: (browserSessionId, watching) =>
      preview.watch(urls.normalizeNativeBrowserSessionId(browserSessionId), Boolean(watching)),
    forgetWatchers: preview.forget,
    captureDesignSelection: page.captureDesignSelection,
    handleCredentialCapture: credentials.handleCapture,
    sessionIdForWebContents: guests.sessionIdFor,
    closeAll: closeAllNativeBrowsers,
    resourceCounts: () => {
      const live = [...nativeBrowsers.values()].filter((entry) => liveContents(entry)).length;
      return { live, sessions: nativeBrowsers.size };
    },
  };
}

module.exports = { createNativeBrowserManager, BROWSER_PARTITION };
