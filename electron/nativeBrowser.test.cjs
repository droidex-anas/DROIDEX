const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { createNativeBrowserManager } = require('./nativeBrowser.cjs');
const { createNativeBrowserBudget } = require('./nativeBrowserBudget.cjs');

const BOUNDS = { x: 0, y: 0, width: 800, height: 600 };
const ERROR_PAGE = 'chrome-error://chromewebdata/';

function createHostWindow() {
  return {
    isDestroyed: () => false,
    contentView: { addChildView() {}, removeChildView() {} },
    setIgnoreMouseEvents() {},
    setContentSize() {},
    on() {},
    close() {},
  };
}

// Each view gets fresh web contents; loading a URL listed in `unreachable`
// lands on Chromium's error page, as an unreachable host does.
function createBrowser() {
  const unreachable = new Set();
  const loads = [];
  const loadFailures = [];
  const views = [];
  const sessions = new Map();
  class WebContentsView {
    constructor(options) {
      this.options = options;
      const contents = new EventEmitter();
      Object.assign(contents, {
        url: 'about:blank',
        destroyed: false,
        isDestroyed: () => contents.destroyed,
        close: () => (contents.destroyed = true),
        getURL: () => contents.url,
        loadURL: async (url) => {
          loads.push(url);
          contents.url = unreachable.has(url) ? ERROR_PAGE : url;
        },
        setWindowOpenHandler() {},
        setBackgroundThrottling() {},
        executeJavaScript: async () => ({ x: 0, y: 0 }),
        capturePage: async () => null,
      });
      this.webContents = contents;
      views.push(this);
    }
    setBounds() {}
    getBounds() {
      return BOUNDS;
    }
    setVisible() {}
  }
  const session = {
    fromPartition(partition) {
      const ses = {
        setDevicePermissionHandler: (handler) => (ses.device = handler),
        setPermissionCheckHandler: (handler) => (ses.check = handler),
        setPermissionRequestHandler: (handler) => (ses.request = handler),
        webRequest: { onCompleted() {}, onErrorOccurred() {} },
      };
      sessions.set(partition, ses);
      return ses;
    },
  };
  const mainWindow = createHostWindow();
  const manager = createNativeBrowserManager({
    app: {},
    appName: 'DROIDEX',
    BrowserWindow: createHostWindow,
    WebContentsView,
    session,
    dialog: {},
    safeStorage: {},
    budget: createNativeBrowserBudget(),
    getMainWindow: () => mainWindow,
    preloadPath: 'nativeBrowserPreload.cjs',
    getHostAppUrl: () => 'http://localhost:5173/',
    sendToRenderer: (channel, payload) => {
      if (channel === 'native-browser-load-failed') loadFailures.push(payload.error);
    },
  });
  const contents = () => views.at(-1).webContents;
  return { manager, unreachable, loads, loadFailures, views, sessions, contents };
}

test('browser pages use their own persistent partition and are denied every permission', async () => {
  const { manager, views, sessions } = createBrowser();
  await manager.open('tab', 'https://example.test/', BOUNDS);

  assert.equal(views[0].options.webPreferences.partition, 'persist:droidex-browser');
  const ses = sessions.get('persist:droidex-browser');
  assert.equal(ses.device({ deviceType: 'hid' }), false);
  assert.equal(ses.check(null, 'media'), false);
  let granted;
  ses.request(null, 'geolocation', (value) => (granted = value));
  assert.equal(granted, false);
});

test('a URL that failed to load is not reopened on restore until it is retried', async () => {
  const { manager, unreachable, loads, loadFailures, contents } = createBrowser();
  const url = 'https://down.test/';
  const restore = async () => {
    manager.detach('tab');
    await manager.attach('tab', BOUNDS, { restoreUrl: url });
  };
  unreachable.add(url);
  await manager.open('tab', url, BOUNDS);
  contents().emit('did-fail-load', {}, -105, 'ERR_NAME_NOT_RESOLVED', url, true);
  assert.deepEqual(loadFailures, ['ERR_NAME_NOT_RESOLVED']);

  await restore();
  assert.deepEqual(loads, [url]);
  await manager.reload('tab');
  assert.deepEqual(loads, [url, url]);

  contents().emit('did-fail-load', {}, -105, 'ERR_NAME_NOT_RESOLVED', url, true);
  await restore();
  assert.deepEqual(loads, [url, url]);
  contents().emit('did-navigate', {}, url);
  await restore();
  assert.deepEqual(loads, [url, url, url]);
});

test('an evicted browser keeps its snapshot until a restore actually loads the page', async (t) => {
  t.mock.method(console, 'error', () => {});
  const { manager, unreachable, loads, loadFailures, contents } = createBrowser();
  const url = 'https://app.test/';
  await manager.open('tab', url);

  manager.evictUnattached();
  // The renderer can die while the snapshot is captured; that is not a crash to recover.
  contents().emit('render-process-gone', {}, { reason: 'crashed', exitCode: 1 });
  await new Promise(setImmediate);
  assert.deepEqual(loadFailures, []);
  assert.equal(manager.resourceCounts().serialized, 1);

  unreachable.add(url);
  await assert.rejects(manager.attach('tab', BOUNDS), /browser is not open/);
  assert.deepEqual(loadFailures, ['Navigation failed']);
  assert.equal(manager.resourceCounts().serialized, 1);

  unreachable.clear();
  await manager.attach('tab', BOUNDS);
  assert.equal(manager.resourceCounts().serialized, 0);
  assert.deepEqual(loads, [url, url, url]);
});
