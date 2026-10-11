const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { createNativeBrowserManager } = require('./nativeBrowser.cjs');

const ERROR_PAGE = 'chrome-error://chromewebdata/';
const HOST = { id: 1 };

// Guests are the <webview> contents the renderer mounts; loading a URL listed
// in `unreachable` lands on Chromium's error page, as an unreachable host does.
function createBrowser() {
  const unreachable = new Set();
  const loads = [];
  const loadFailures = [];
  const sessions = new Map();
  const events = [];
  const settings = { homePage: 'https://www.google.com/', showAgentCursor: true };
  const cleared = [];
  const session = {
    fromPartition(partition) {
      if (sessions.has(partition)) return sessions.get(partition);
      const ses = {
        clearStorageData: async (options) => cleared.push(options),
        clearCache: async () => cleared.push('cache'),
        clearAuthCache: async () => cleared.push('auth'),
        setDevicePermissionHandler: (handler) => (ses.device = handler),
        setPermissionCheckHandler: (handler) => (ses.check = handler),
        setPermissionRequestHandler: (handler) => (ses.request = handler),
        webRequest: { onSendHeaders() {}, onCompleted() {}, onErrorOccurred() {} },
      };
      sessions.set(partition, ses);
      return ses;
    },
  };
  const manager = createNativeBrowserManager({
    app: { getPath: () => '/unused-browser-test-profile' },
    appName: 'DROIDEX',
    session,
    dialog: {},
    safeStorage: {},
    getSettings: () => settings,
    cancelBrowserRequests() {},
    getMainWindow: () => ({ isDestroyed: () => false }),
    onBrowserInput() {},
    preloadPath: '/app/nativeBrowserPreload.cjs',
    getHostAppUrl: () => 'http://localhost:5173/',
    sendToRenderer: (channel, payload) => {
      events.push({ channel, ...payload });
      if (channel === 'native-browser-load-failed') loadFailures.push(payload.error);
    },
  });

  // What the renderer and Electron do when the pane mounts a page.
  function mountGuest(browserSessionId, savedUrl) {
    const { src } = manager.reserve(browserSessionId, HOST, savedUrl);
    const webPreferences = {};
    manager.handleWillAttach({ preventDefault() {} }, webPreferences, { src }, HOST);
    const guest = new EventEmitter();
    Object.assign(guest, {
      url: 'about:blank',
      webPreferences,
      getType: () => 'webview',
      isDestroyed: () => guest.destroyed === true,
      close: () => {
        guest.destroyed = true;
        guest.emit('destroyed');
      },
      getURL: () => guest.url,
      navigationHistory: {
        getActiveIndex: () => 0,
        canGoBack: () => false,
        canGoForward: () => false,
      },
      loadURL: async (url) => {
        loads.push(url);
        guest.url = unreachable.has(url) ? ERROR_PAGE : url;
      },
      reload: () => loads.push(`reload:${guest.url}`),
      setWindowOpenHandler() {},
      setBackgroundThrottling() {},
    });
    manager.handleCreated(guest);
    manager.handleAttached(guest);
    return guest;
  }

  return {
    manager,
    mountGuest,
    unreachable,
    loads,
    loadFailures,
    sessions,
    settings,
    events,
    cleared,
  };
}

test('browser pages use their own persistent partition and are denied every permission', async () => {
  const { manager, mountGuest, sessions } = createBrowser();
  const guest = mountGuest('tab');
  await manager.open('tab', 'https://example.test/');

  assert.equal(guest.webPreferences.partition, 'persist:droidex-browser');
  const ses = sessions.get('persist:droidex-browser');
  assert.equal(ses.device({ deviceType: 'hid' }), false);
  assert.equal(ses.check(null, 'media'), false);
  let granted;
  ses.request(null, 'geolocation', (value) => (granted = value));
  assert.equal(granted, false);
});

test('a remounted page reopens its URL, but not one that failed until it is retried', async () => {
  const { manager, mountGuest, unreachable, loads, loadFailures } = createBrowser();
  const url = 'https://down.test/';
  const remount = () => {
    manager.release('tab');
    return mountGuest('tab');
  };
  unreachable.add(url);
  let guest = mountGuest('tab');
  await manager.open('tab', url);
  guest.emit('did-fail-load', {}, -105, 'ERR_NAME_NOT_RESOLVED', url, true);
  assert.deepEqual(loadFailures, ['ERR_NAME_NOT_RESOLVED']);

  guest = remount();
  assert.deepEqual(loads, [url]);
  await manager.reload('tab');
  assert.deepEqual(loads, [url, url]);

  unreachable.clear();
  guest.emit('did-navigate', {}, url);
  remount();
  await new Promise(setImmediate);
  assert.deepEqual(loads, [url, url, url]);
});

test('a crashed page reports the crash and blocks actions until it is reloaded', async (t) => {
  t.mock.method(console, 'error', () => {});
  const { manager, mountGuest, loads, loadFailures } = createBrowser();
  const guest = mountGuest('tab');
  await manager.open('tab', 'https://app.test/');

  guest.emit('render-process-gone', {}, { reason: 'crashed', exitCode: 1 });
  assert.deepEqual(loadFailures, ['crashed']);
  await assert.rejects(manager.open('tab', 'https://app.test/next'), /crashed/);

  await manager.reload('tab');
  await manager.open('tab', 'https://app.test/next');
  assert.deepEqual(loads, [
    'https://app.test/',
    'reload:https://app.test/',
    'https://app.test/next',
  ]);
});

test('a page action still waiting on a load does nothing once the browser closes', async () => {
  const { manager, mountGuest } = createBrowser();
  const guest = mountGuest('tab');
  await manager.open('tab', 'https://app.test/');
  let finishLoad;
  guest.loadURL = () => new Promise((resolve) => (finishLoad = resolve));
  guest.navigationHistory.canGoBack = () => true;
  guest.navigationHistory.goBack = () => assert.fail('went back after the browser closed');
  const opening = manager.open('tab', 'https://app.test/next');
  await new Promise(setImmediate);

  const back = manager.goBack('tab');
  await new Promise(setImmediate);
  manager.close('tab');
  finishLoad();
  await assert.rejects(back, /browser is not open/);
  await opening;
});

test('only the first blank open of a new tab uses Home; a mounted guest loads its saved page or none', async () => {
  const { manager, mountGuest, settings, loads } = createBrowser();
  settings.homePage = 'https://home.test/';
  const opening = manager.open('new', 'about:blank');
  mountGuest('new');
  await opening;
  mountGuest('blank', 'about:blank');
  await new Promise(setImmediate);
  mountGuest('restored', 'https://saved.test/');
  await new Promise(setImmediate);
  settings.homePage = 'https://next-home.test/';
  await manager.openHome('restored');
  await manager.open('restored', 'about:blank');
  assert.deepEqual(loads, [
    'https://home.test/',
    'https://saved.test/',
    'https://next-home.test/',
    'about:blank',
  ]);
});

test('clearing closes pages and clears only the browser partition before allowing a new tab', async () => {
  const { manager, mountGuest, sessions, cleared, events } = createBrowser();
  const guest = mountGuest('tab');
  await manager.open('tab', 'https://app.test/');
  const started = Promise.withResolvers();
  const resume = Promise.withResolvers();
  sessions.get('persist:droidex-browser').clearStorageData = async (options) => {
    cleared.push(options);
    started.resolve();
    await resume.promise;
  };
  const clearing = manager.clearBrowsingData();
  await started.promise;
  assert.equal(guest.isDestroyed(), true);
  assert.equal(manager.resourceCounts().sessions, 0);
  assert.throws(() => mountGuest('replacement'), /data is being cleared/);
  assert.equal(events.length, 0);
  resume.resolve();
  await clearing;
  assert.deepEqual(events, [{ channel: 'native-browser-data-cleared' }]);
  assert.deepEqual(cleared, [
    { storages: ['cookies', 'localstorage', 'indexdb', 'serviceworkers', 'cachestorage'] },
    'cache',
    'auth',
  ]);
  assert.deepEqual([...sessions.keys()], ['persist:droidex-browser']);
  mountGuest('replacement');
  await new Promise(setImmediate);
});
