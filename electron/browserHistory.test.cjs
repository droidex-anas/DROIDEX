const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { EventEmitter } = require('node:events');
const { createBrowserHistory } = require('./browserHistory.cjs');
const { createNativeBrowserViewFactory } = require('./nativeBrowserView.cjs');

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

test('suggestions rank URL prefixes before titles, then typed, user visits and recency', async (t) => {
  const { history, options } = await setup(t);
  let now = 1_000_000;
  t.mock.method(Date, 'now', () => now);
  await history.recordVisit('https://docs.test/typed', 'agent');
  await history.recordTyped('https://docs.test/typed');
  await history.recordTyped('https://docs.test/typed');
  await history.recordVisit('https://docs.test/old', 'agent');
  now += 86_400_000;
  await history.recordVisit('https://docs.test/agent', 'agent');
  await history.recordVisit('https://docs.test/user', 'user');
  await history.recordVisit('https://other.test/', 'user');
  await history.updateTitle('https://other.test/', 'Docs documentation');
  for (let index = 0; index < 4; index += 1) await history.recordTyped('https://other.test/');

  const reopened = createBrowserHistory(options);
  const matches = await reopened.suggest('DOCS', 5);
  assert.deepEqual(
    matches.map((entry) => entry.url),
    [
      'https://docs.test/typed',
      'https://docs.test/user',
      'https://docs.test/agent',
      'https://docs.test/old',
      'https://other.test/',
    ],
  );
  assert.equal(matches[0].typedCount, 2);
  assert.equal(matches[0].agentVisitCount, 1);
  assert.equal(matches[1].userVisitCount, 1);
  assert.equal(matches[1].lastVisitedAt, now);
  assert.deepEqual(
    (await reopened.suggest('https://docs.test/us', 1)).map((entry) => entry.url),
    ['https://docs.test/user'],
  );
});

test('history filters sensitive and non-web URLs and serializes removal and clear', async (t) => {
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
    ...[
      'token',
      'code',
      'password',
      'session',
      'auth',
      'key',
      'secret',
      'access_token',
      'API_KEY',
    ].map((key) => `https://example.test/?${key}=private`),
  ];
  for (const url of skipped) {
    await history.recordTyped(url);
    await history.recordVisit(url, 'user');
  }
  const safe = 'https://example.test/?q=readable&sort=date';
  await history.recordTyped(safe);
  assert.deepEqual(await history.suggest(''), []);
  await history.recordVisit(safe, 'user');
  await history.updateTitle(safe, 'Search results');
  assert.deepEqual(
    (await history.suggest('results')).map((entry) => entry.url),
    [safe],
  );
  const persisted = JSON.parse(await fs.readFile(file, 'utf8'));
  assert.equal(persisted.entries.length, 1);
  assert.equal(persisted.entries[0].url, safe);
  await history.remove(safe);
  assert.deepEqual(await history.suggest(''), []);

  await Promise.all([history.recordVisit(safe, 'agent'), history.clear()]);
  assert.deepEqual(JSON.parse(await fs.readFile(file, 'utf8')).entries, []);
  await assert.rejects(history.suggest('test', 51), /limit/);
});

test('history caps at 5000 entries and evicts the least recently visited across restarts', async (t) => {
  const { history, options, file } = await setup(t);
  const entries = Array.from({ length: 5_000 }, (_, index) => ({
    url: `https://example.test/page-${index}`,
    title: '',
    visitCount: 1,
    typedCount: 0,
    userVisitCount: 1,
    agentVisitCount: 0,
    lastVisitedAt: index,
  }));
  await fs.writeFile(file, JSON.stringify({ version: 1, entries }));
  t.mock.method(Date, 'now', () => 10_000);
  await history.recordVisit('https://example.test/page-0', 'user');
  await history.recordVisit('https://new.test/', 'agent');
  const persisted = JSON.parse(await fs.readFile(file, 'utf8')).entries;
  assert.equal(persisted.length, 5_000);
  assert.ok(persisted.some((entry) => entry.url === 'https://example.test/page-0'));
  assert.ok(!persisted.some((entry) => entry.url === 'https://example.test/page-1'));
  assert.equal((await createBrowserHistory(options).suggest('new.test'))[0].visitCount, 1);
});

test('bound guests record successful top-level visits and titles, preserving navigation source', async (t) => {
  const { history } = await setup(t);
  const ses = {
    setDevicePermissionHandler() {},
    setPermissionCheckHandler() {},
    setPermissionRequestHandler() {},
    webRequest: { onSendHeaders() {}, onCompleted() {}, onErrorOccurred() {} },
  };
  const views = createNativeBrowserViewFactory({
    session: { fromPartition: () => ses },
    partition: 'persist:droidex-browser',
    history,
    urls: { isChromeErrorUrl: (url) => url.startsWith('chrome-error:') },
    emitLoaded() {},
    onInput() {},
    listEntries: () => [],
  });
  const entry = views.createEntry('browser-1');
  function guest() {
    const contents = new EventEmitter();
    Object.assign(contents, {
      url: 'about:blank',
      isDestroyed: () => false,
      getURL: () => contents.url,
      getTitle: () => 'A page',
      setWindowOpenHandler() {},
      navigationHistory: { getActiveIndex: () => 0 },
    });
    views.bindGuest(entry, contents);
    return contents;
  }
  const contents = guest();
  entry.historyInput.source = 'agent';
  contents.emit('did-start-navigation', { isMainFrame: true, isSameDocument: false });
  contents.url = 'https://example.test/';
  contents.emit('did-navigate', {}, contents.url, 200);
  contents.emit('page-title-updated', {}, 'Example');
  contents.emit('before-mouse-event', {}, { type: 'mouseDown' });
  contents.emit('did-start-navigation', { isMainFrame: true, isSameDocument: true });
  contents.url = 'https://example.test/next';
  contents.emit('did-navigate-in-page', {}, contents.url, true);
  contents.emit('did-navigate-in-page', {}, 'https://frame.test/', false);
  contents.emit('did-start-navigation', { isMainFrame: true, isSameDocument: false });
  contents.url = 'https://example.test/error';
  contents.emit('did-navigate', {}, contents.url, 500);
  contents.emit('page-title-updated', {}, 'Server error');
  guest();
  contents.emit('did-navigate', {}, 'https://stale.test/', 200);
  await history.flush();
  const entries = await history.suggest('example');
  assert.equal(entries.length, 2);
  assert.equal(entries.find((row) => row.url === 'https://example.test/').agentVisitCount, 1);
  assert.equal(entries.find((row) => row.url === 'https://example.test/').title, 'Example');
  assert.equal(entries.find((row) => row.url.endsWith('/next')).userVisitCount, 1);
  assert.deepEqual(await history.suggest('frame.test'), []);
  assert.deepEqual(await history.suggest('stale.test'), []);
});
