const assert = require('node:assert/strict');
const test = require('node:test');
const { EventEmitter } = require('node:events');
const {
  beginAgentBrowserAction,
  createBrowserAuthenticationPopups,
  consumeAuthenticationPopup,
  grantAuthenticationPopup,
} = require('./browserAuthenticationPopup.cjs');

const TARGET = 'https://accounts.example/authorize?client=droidex';
const PARTITION = 'persist:droidex-browser';

function fixture() {
  const contents = new EventEmitter();
  let handler;
  let destroyed = false;
  let focused = 0;
  Object.assign(contents, {
    isDestroyed: () => destroyed,
    setWindowOpenHandler: (next) => {
      handler = next;
    },
    focus: () => focused++,
  });
  const entry = { contents, documents: 4 };
  const loads = [];
  const parent = {};
  const popups = createBrowserAuthenticationPopups({
    partition: PARTITION,
    isAllowedUrl: (url) => !url.startsWith('https://app.example/'),
    loadUrl: (_entry, url) => loads.push(url),
    getMainWindow: () => parent,
  });
  popups.bind(entry, contents);
  const abort = new AbortController();
  const request = { signal: abort.signal, startBy: Date.now() + 60_000, runEnded: () => false };
  const open = (url = TARGET, extra = {}) => handler({ url, ...extra });
  const gesture = () => contents.emit('before-mouse-event', {}, { type: 'mouseDown' });
  return {
    entry,
    contents,
    request,
    abort,
    popups,
    open,
    gesture,
    loads,
    parent,
    focused: () => focused,
    destroy: () => {
      destroyed = true;
      contents.emit('destroyed');
    },
  };
}

function childWindow() {
  const window = new EventEmitter();
  const contents = new EventEmitter();
  let handler;
  window.destroyed = false;
  window.webContents = contents;
  window.setMenuBarVisibility = () => {};
  window.destroy = () => {
    window.destroyed = true;
    window.emit('closed');
  };
  contents.setWindowOpenHandler = (next) => {
    handler = next;
  };
  window.open = () => handler({ url: TARGET });
  return window;
}

test('approved OAuth popups are single-use and bound to the exact live document and request', () => {
  const f = fixture();
  grantAuthenticationPopup(f.entry, f.contents, TARGET, f.request, 1_000);
  assert.equal(consumeAuthenticationPopup(f.entry, f.contents, TARGET, 1_001), true);
  assert.equal(consumeAuthenticationPopup(f.entry, f.contents, TARGET, 1_002), undefined);

  for (const invalidate of [
    (g) => {
      g.entry.documents++;
    },
    (g) => {
      g.entry.contents = {};
    },
    (g) => {
      g.abort.abort();
    },
    (g) => {
      g.request.runEnded = () => true;
    },
    (g) => {
      g.request.runEnded = () => {
        throw new Error('Agent access revoked');
      };
    },
  ]) {
    const g = fixture();
    grantAuthenticationPopup(g.entry, g.contents, TARGET, g.request, 1_000);
    invalidate(g);
    assert.equal(consumeAuthenticationPopup(g.entry, g.contents, TARGET, 1_002), false);
  }
  const overdue = fixture();
  overdue.request.startBy = 1_001;
  grantAuthenticationPopup(overdue.entry, overdue.contents, TARGET, overdue.request, 1_000);
  assert.equal(consumeAuthenticationPopup(overdue.entry, overdue.contents, TARGET, 1_002), false);
  const expired = fixture();
  grantAuthenticationPopup(expired.entry, expired.contents, TARGET, expired.request, 1_000);
  assert.equal(consumeAuthenticationPopup(expired.entry, expired.contents, TARGET, 11_000), false);
});

test('an approved popup rejects a different URL and cannot reuse the consumed approval', () => {
  const f = fixture();
  grantAuthenticationPopup(f.entry, f.contents, TARGET, f.request);
  assert.deepEqual(f.open('https://accounts.example/authorize?client=attacker'), {
    action: 'deny',
  });
  assert.deepEqual(f.open(), { action: 'deny' });
  assert.deepEqual(f.loads, []);
  assert.throws(
    () => grantAuthenticationPopup(f.entry, f.contents, undefined, f.request),
    /exact HTTP/,
  );
});

test('native sign-in windows are sandboxed children and ordinary blank links stay in the pane', () => {
  const f = fixture();
  grantAuthenticationPopup(f.entry, f.contents, TARGET, f.request);
  const response = f.open();
  assert.equal(response.action, 'allow');
  assert.equal(response.outlivesOpener, false);
  assert.equal(response.overrideBrowserWindowOptions.parent, f.parent);
  assert.equal(response.overrideBrowserWindowOptions.frame, true);
  assert.deepEqual(response.overrideBrowserWindowOptions.webPreferences, {
    partition: PARTITION,
    preload: '',
    contextIsolation: true,
    nodeIntegration: false,
    nodeIntegrationInSubFrames: false,
    sandbox: true,
    webSecurity: true,
    webviewTag: false,
    disablePopups: true,
  });
  f.gesture();
  assert.deepEqual(f.open('https://example.com/article'), { action: 'deny' });
  assert.deepEqual(f.loads, ['https://example.com/article']);
});

test('only a fresh direct user gesture can open an unapproved sign-in popup', (t) => {
  let now = 1_000;
  t.mock.method(Date, 'now', () => now);
  const f = fixture();
  assert.deepEqual(f.open(), { action: 'deny' });
  f.gesture();
  now += 1_000;
  assert.deepEqual(f.open(), { action: 'deny' });
  f.gesture();
  assert.equal(f.open().action, 'allow');
  assert.deepEqual(f.open(), { action: 'deny' });
  const finish = beginAgentBrowserAction(f.entry, f.contents, f.request);
  f.gesture();
  grantAuthenticationPopup(f.entry, f.contents, TARGET, f.request);
  finish();
  assert.equal(f.entry.authenticationPopupCapability, null);
  assert.deepEqual(f.open(), { action: 'deny' });
  f.gesture();
  beginAgentBrowserAction(f.entry, f.contents, f.request)();
  assert.deepEqual(f.open(), { action: 'deny' });
  f.gesture();
  f.contents.emit('did-start-navigation', {}, TARGET, false, true);
  assert.deepEqual(f.open(), { action: 'deny' });
  assert.deepEqual(f.loads, []);
});

test('popup pages reject nested windows, unsafe navigation and webviews but allow long OAuth redirects', () => {
  const f = fixture();
  const child = childWindow();
  f.contents.emit('did-create-window', child);
  assert.deepEqual(child.open(), { action: 'deny' });
  const prevented = (name, ...args) => {
    let result = false;
    child.webContents.emit(
      name,
      {
        preventDefault: () => {
          result = true;
        },
      },
      ...args,
    );
    return result;
  };
  assert.equal(prevented('will-navigate', 'file:///tmp/private'), true);
  assert.equal(prevented('will-navigate', 'https://app.example/shell'), true);
  assert.equal(prevented('will-redirect', 'javascript:alert(1)', false, true), true);
  assert.equal(
    prevented('will-redirect', `https://idp.example/saml?r=${'a'.repeat(9_000)}`, false, true),
    false,
  );
  assert.equal(prevented('will-attach-webview'), true);
  for (const url of [
    'about:blank',
    'file:///tmp/private',
    'https://user:secret@example.com/',
    'https://app.example/shell',
  ]) {
    f.gesture();
    assert.deepEqual(f.open(url, { features: 'width=500' }), { action: 'deny' });
  }
});

test('popups close and detach their listeners when their opener is released, replaced or destroyed', () => {
  for (const invalidate of [
    (f) => f.popups.close(f.entry),
    (f) => {
      f.entry.contents = fixture().contents;
      f.popups.bind(f.entry, f.entry.contents);
    },
    (f) => f.destroy(),
  ]) {
    const f = fixture();
    const child = childWindow();
    f.contents.emit('did-create-window', child);
    invalidate(f);
    assert.equal(child.destroyed, true);
    assert.equal(f.contents.listenerCount('did-start-navigation'), 0);
    assert.equal(f.contents.listenerCount('before-mouse-event'), 0);
  }
  const f = fixture();
  const child = childWindow();
  f.contents.emit('did-create-window', child);
  child.destroy();
  assert.equal(f.focused(), 1);
  const navigatingChild = childWindow();
  f.contents.emit('did-create-window', navigatingChild);
  f.contents.emit('did-start-navigation', {}, TARGET, false, true);
  assert.equal(navigatingChild.destroyed, true);
  f.popups.close(f.entry);
});
