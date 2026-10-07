const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const test = require('node:test');
const { createBrowserGuests } = require('./browserGuests.cjs');

function fakeGuest() {
  const guest = new EventEmitter();
  guest.closed = false;
  guest.getType = () => 'webview';
  guest.isDestroyed = () => false;
  guest.close = () => {
    guest.closed = true;
  };
  return guest;
}

function attach(guests, src, host) {
  const event = {
    prevented: false,
    preventDefault() {
      this.prevented = true;
    },
  };
  const webPreferences = { preload: '/evil.js', webSecurity: false, partition: 'persist:evil' };
  const params = { instanceId: '7', src, useragent: 'EvilUA/1.0', allowpopups: 'true' };
  guests.handleWillAttach(event, webPreferences, params, host);
  return { event, webPreferences, params };
}

test('a reserved guest attaches once, hardened, and binds to its session', async () => {
  const bound = [];
  const guests = createBrowserGuests({
    partition: 'persist:droidex-browser',
    preloadPath: '/app/page.cjs',
    onBound: (id, contents) => bound.push([id, contents]),
  });
  const host = { id: 1 };
  const { src } = guests.reserve('browser-1', host);
  const waiting = guests.waitForGuest('browser-1');

  const { event, webPreferences, params } = attach(guests, src, host);
  const guest = fakeGuest();
  guests.handleCreated(guest);
  assert.deepEqual(bound, []);
  guests.handleAttached(guest);

  assert.equal(event.prevented, false);
  assert.equal(webPreferences.partition, 'persist:droidex-browser');
  assert.equal(webPreferences.preload, '/app/page.cjs');
  assert.equal(webPreferences.webSecurity, true);
  assert.equal(webPreferences.disablePopups, false);
  assert.deepEqual(params, { instanceId: '7', src: '' });
  assert.equal(await waiting, guest);
  assert.deepEqual(bound, [['browser-1', guest]]);
  assert.equal(guests.sessionIdFor(guest), 'browser-1');

  // The same token cannot attach a second guest.
  assert.equal(attach(guests, src, host).event.prevented, true);
});

test('forged, wrong-host and unreserved guests never run', () => {
  const guests = createBrowserGuests({ partition: 'p', preloadPath: '/p.cjs', onBound() {} });
  const { src } = guests.reserve('browser-1', { id: 1 });

  assert.equal(attach(guests, 'about:blank#droidex=forged', { id: 1 }).event.prevented, true);
  assert.equal(attach(guests, src, { id: 2 }).event.prevented, true);

  const stray = fakeGuest();
  guests.handleCreated(stray);
  assert.equal(stray.closed, true);
});
