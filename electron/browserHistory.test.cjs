const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { EventEmitter } = require('node:events');
const { createBrowserHistory } = require('./browserHistory.cjs');
const { createNativeBrowserManager } = require('./nativeBrowser.cjs');
const { createNativeBrowserRequests } = require('./nativeBrowserRequests.cjs');

async function setup(t) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'droidex-browser-history-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const options = { userData: () => directory };
  return {
    history: createBrowserHistory(options),
    options,
    file: path.join(directory, 'browser-history.json'),
  };
}

async function commit(history, ...operations) {
  const completed = Promise.all(operations);
  await history.flush();
  await completed;
}

function browserWithHistory(history) {
  const ses = {
    setDevicePermissionHandler() {},
    setPermissionCheckHandler() {},
    setPermissionRequestHandler() {},
    webRequest: { onSendHeaders() {}, onCompleted() {}, onErrorOccurred() {} },
  };
  const manager = createNativeBrowserManager({
    app: {},
    appName: 'DROIDEX',
    history,
    session: { fromPartition: () => ses },
    dialog: {},
    safeStorage: {},
    getMainWindow: () => ({ isDestroyed: () => false }),
    onBrowserInput() {},
    preloadPath: '/app/nativeBrowserPreload.cjs',
    getHostAppUrl: () => 'http://localhost:5173/',
    sendToRenderer() {},
  });
  const host = { id: 1 };
  function guest() {
    const { src } = manager.reserve('tab', host);
    manager.handleWillAttach({ preventDefault() {} }, {}, { src }, host);
    const contents = new EventEmitter();
    Object.assign(contents, {
      url: 'about:blank',
      getType: () => 'webview',
      isDestroyed: () => false,
      getURL: () => contents.url,
      getTitle: () => 'A page',
      setWindowOpenHandler() {},
      setBackgroundThrottling() {},
      navigationHistory: {
        getActiveIndex: () => 0,
        canGoBack: () => false,
        canGoForward: () => false,
      },
      loadURL: async (url) => {
        contents.emit('did-start-navigation', { url, isMainFrame: true, isSameDocument: false });
      },
    });
    manager.handleCreated(contents);
    manager.handleAttached(contents);
    return contents;
  }
  return { manager, guest };
}

test('suggestions rank prefixes before titles, then typed visits, visits and recency', async (t) => {
  const { history, options } = await setup(t);
  let now = 1_000_000;
  t.mock.method(Date, 'now', () => now);
  await commit(
    history,
    history.recordVisit('https://docs.test/typed', true),
    history.recordVisit('https://docs.test/typed', true),
    history.recordVisit('https://docs.test/old'),
  );
  now += 86_400_000;
  await commit(
    history,
    history.recordVisit('https://docs.test/recent'),
    history.recordVisit('https://docs.test/frequent'),
    history.recordVisit('https://docs.test/frequent'),
    history.recordVisit('https://other.test/', true),
    history.updateTitle('https://other.test/', 'Docs documentation'),
  );
  const matches = await createBrowserHistory(options).suggest('DOCS', 5);
  assert.deepEqual(
    matches.map((entry) => entry.url),
    [
      'https://docs.test/typed',
      'https://docs.test/frequent',
      'https://docs.test/recent',
      'https://docs.test/old',
      'https://other.test/',
    ],
  );
  assert.equal(matches[0].typedCount, 2);
  assert.equal(matches[1].visitCount, 2);
  assert.equal(matches[1].lastVisitedAt, now);
});

test('history strips sensitive queries, OAuth fragments and nested URLs using diagnostic rules', async (t) => {
  const { history, file } = await setup(t);
  const skipped = [
    'about:blank',
    'data:text/plain,test',
    'blob:https://example.test/id',
    'file:///tmp/test',
    'chrome://settings',
    'chrome-error://chromewebdata/',
    'https://user:password@example.test/',
    'not a URL',
  ];
  const sensitive = [
    ...[
      'token',
      'code',
      'password',
      'session',
      'auth',
      'key',
      'secret',
      'csrf',
      'otp',
      'cookie',
      'credential',
      'passcode',
      'sig',
      'signature',
      'X-Amz-Date',
      'X-Amz-Signature',
    ].map((key) => `https://example.test/${key}?${key}=private&safe=yes`),
    ...['access_token', 'id_token', 'code'].map(
      (key) => `https://example.test/fragment-${key}?safe=yes#${key}=private`,
    ),
    'https://example.test/nested?next=/callback?code=private',
    'https://example.test/relative?next=callback%3Fcode%3Dprivate',
    'https://example.test/relative-fragment?next=%23access_token%3Dprivate',
    'https://example.test/nested-fragment?next=https%3A%2F%2Fother.test%2F%23access_token%3Dprivate',
    'https://example.test/nested-signature?next=/download?sig=private',
    'https://example.test/nested-amz?next=/download?X-Amz-Date=private',
    'https://example.test/fragment-next#next=/callback?code=private',
  ];
  const safe = 'https://example.test/?q=readable&sort=date#section';
  await commit(history, ...[...skipped, ...sensitive, safe].map((url) => history.recordVisit(url)));
  const persisted = JSON.parse(await fs.readFile(file, 'utf8'));
  assert.deepEqual(
    persisted.entries.map((entry) => entry.url),
    [
      ...sensitive.map((value) => {
        const url = new URL(value);
        return url.origin + url.pathname;
      }),
      safe,
    ],
  );
  assert.doesNotMatch(await fs.readFile(file, 'utf8'), /private/);
  await commit(history, history.updateTitle(safe, 'Search results'));
  assert.equal((await history.suggest('results'))[0].url, safe);
  await commit(history, history.remove(safe));
  assert.deepEqual(await history.suggest('results'), []);
  await commit(history, history.recordVisit(safe), history.clear());
  assert.deepEqual(JSON.parse(await fs.readFile(file, 'utf8')).entries, []);
  await assert.rejects(history.suggest('test', 51), /limit/);
});

test('failed mutations retain committed memory and a removal retry persists', async (t) => {
  const { history, options } = await setup(t);
  const url = 'https://example.test/';
  await commit(history, history.recordVisit(url));
  const committed = await history.suggest('');
  const failureMock = t.mock.method(fs, 'rename', async () => {
    throw Object.assign(new Error('disk failure'), { code: 'EIO' });
  });
  for (const operation of [
    () => history.remove(url),
    () => history.clear(),
    () => history.recordVisit(url, true),
    () => history.updateTitle(url, 'Unsaved'),
  ]) {
    const failure = assert.rejects(operation(), /disk failure/);
    await assert.rejects(history.flush(), /disk failure/);
    await failure;
    assert.deepEqual(await history.suggest(''), committed);
    assert.deepEqual(await createBrowserHistory(options).suggest(''), committed);
  }
  failureMock.mock.restore();
  await commit(history, history.remove(url));
  assert.deepEqual(await createBrowserHistory(options).suggest(''), []);
});

test('history caps successful visits at 5000 and persists the latest coalesced snapshot', async (t) => {
  const { history, options, file } = await setup(t);
  const entries = Array.from({ length: 5_000 }, (_, index) => ({
    url: `https://example.test/page-${index}`,
    title: '',
    visitCount: 1,
    typedCount: 0,
    lastVisitedAt: index,
  }));
  await fs.writeFile(file, JSON.stringify({ version: 2, entries }));
  t.mock.method(Date, 'now', () => 10_000);
  const write = t.mock.method(fs, 'writeFile');
  await commit(
    history,
    history.recordVisit('https://example.test/page-0'),
    history.recordVisit('https://new.test/'),
    history.updateTitle('https://new.test/', 'First title'),
    history.updateTitle('https://new.test/', 'Final title'),
  );
  assert.equal(write.mock.callCount(), 1);
  const serialized = await fs.readFile(file, 'utf8');
  assert.equal(serialized.trim().split('\n').length, 1);
  const persisted = JSON.parse(serialized).entries;
  assert.equal(persisted.length, 5_000);
  assert.ok(persisted.some((entry) => entry.url === 'https://example.test/page-0'));
  assert.ok(!persisted.some((entry) => entry.url === 'https://example.test/page-1'));
  assert.equal((await createBrowserHistory(options).suggest('new.test'))[0].title, 'Final title');
});

test('debounced writes serialize in-flight batches and preserve the latest queued changes', async (t) => {
  const { history, options } = await setup(t);
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const started = Promise.withResolvers();
  const release = Promise.withResolvers();
  const rename = fs.rename;
  let activeWrites = 0;
  let peakWrites = 0;
  let writes = 0;
  t.mock.method(fs, 'rename', async (...args) => {
    activeWrites += 1;
    peakWrites = Math.max(peakWrites, activeWrites);
    writes += 1;
    try {
      if (writes === 1) {
        started.resolve();
        await release.promise;
      }
      return await rename(...args);
    } finally {
      activeWrites -= 1;
    }
  });
  const first = history.recordVisit('https://example.test/');
  t.mock.timers.tick(999);
  assert.equal(writes, 0);
  t.mock.timers.tick(1);
  await started.promise;
  assert.deepEqual(await history.suggest(''), []);
  const second = history.recordVisit('https://example.test/', true);
  const title = history.updateTitle('https://example.test/', 'Latest title');
  const flushed = history.flush();
  release.resolve();
  await Promise.all([first, second, title, flushed]);
  assert.equal(peakWrites, 1);
  assert.equal(writes, 2);
  const [entry] = await createBrowserHistory(options).suggest('');
  assert.equal(entry.visitCount, 2);
  assert.equal(entry.typedCount, 1);
  assert.equal(entry.title, 'Latest title');
});

test('www prefixes match hosts and paths consistently', async (t) => {
  const { history } = await setup(t);
  await commit(history, history.recordVisit('https://www.example.test/docs'));
  for (const prefix of [
    'example.test',
    'example.test/do',
    'www.example.test/do',
    'https://example.test/do',
    'https://www.example.test/do',
  ]) {
    assert.equal((await history.suggest(prefix))[0].url, 'https://www.example.test/docs');
  }
});

test('typed intent creates no entry and follows a successful redirect, but not a failed attempt', async (t) => {
  const { history } = await setup(t);
  const { manager, guest } = browserWithHistory(history);
  const requests = createNativeBrowserRequests({ manager, notifyRenderer() {} });
  const contents = guest();
  requests.recordTyped('app', 'https://example.test/');
  assert.deepEqual(await history.suggest(''), []);
  await requests.handle(
    {
      type: 'browser.request',
      id: 'open',
      request: {
        requestId: 'open',
        appSessionId: 'app',
        browserSessionId: 'tab',
        action: 'open',
        url: 'https://example.test/',
      },
    },
    () => {},
    () => false,
  );
  contents.url = 'https://www.example.test/final';
  contents.emit('did-redirect-navigation', { isMainFrame: true, url: contents.url });
  contents.emit('did-navigate', {}, contents.url, 200);
  contents.emit('page-title-updated', {}, 'Redirected');
  await history.flush();
  assert.deepEqual(
    (await history.suggest('')).map(({ url, typedCount }) => ({ url, typedCount })),
    [{ url: contents.url, typedCount: 1 }],
  );
  manager.recordTyped('tab', 'https://failed.test/');
  contents.emit('did-start-navigation', { isMainFrame: true, url: 'https://failed.test/' });
  contents.emit('did-fail-provisional-load', {}, -3, 'ERR_ABORTED', 'https://failed.test/', true);
  contents.emit('page-title-updated', {}, 'Still here');
  contents.url += '#section';
  contents.emit('did-navigate-in-page', {}, contents.url, true);
  contents.emit('did-navigate-in-page', {}, 'https://frame.test/', false);
  await history.flush();
  assert.equal(
    (await history.suggest('example.test/final', 2)).find((entry) => entry.url.endsWith('/final'))
      .title,
    'Still here',
  );
  assert.equal((await history.suggest('example.test/final#section'))[0].typedCount, 0);
  contents.url = 'https://example.test/error';
  contents.emit('did-navigate', {}, contents.url, 500);
  contents.emit('page-title-updated', {}, 'Server error');
  guest();
  contents.emit('did-navigate', {}, 'https://stale.test/', 200);
  await history.flush();
  assert.deepEqual(await history.suggest('failed.test'), []);
  assert.deepEqual(await history.suggest('frame.test'), []);
  assert.deepEqual(await history.suggest('stale.test'), []);
  assert.deepEqual(await history.suggest('/error'), []);
});
