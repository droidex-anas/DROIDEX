const test = require('node:test');
const assert = require('node:assert/strict');

const {
  CANVAS_PREVIEW_CSP,
  CANVAS_PREVIEW_URL,
  canvasPreviewDocument,
  createCanvasPreviewHosts,
} = require('./canvasPreview.cjs');

function createGuest(id) {
  const listeners = new Map();
  return {
    id,
    crashes: 0,
    destroyed: false,
    windowOpenHandler: null,
    isDestroyed() {
      return this.destroyed;
    },
    forcefullyCrashRenderer() {
      this.crashes += 1;
    },
    setWindowOpenHandler(handler) {
      this.windowOpenHandler = handler;
    },
    on(event, listener) {
      listeners.set(event, listener);
      return this;
    },
    emit(event, ...args) {
      const listener = listeners.get(event);
      if (!listener) throw new Error(`No listener for ${event}`);
      listener(...args);
    },
  };
}

function createHosts() {
  const logged = [];
  return { hosts: createCanvasPreviewHosts({ log: (message) => logged.push(message) }), logged };
}

test('the intermediate forbids every network source and allows only about: frames', () => {
  const directives = new Map(
    CANVAS_PREVIEW_CSP.split('; ').map((directive) => {
      const [name, ...values] = directive.split(' ');
      return [name, values.join(' ')];
    }),
  );

  assert.equal(directives.get('default-src'), "'none'");
  assert.equal(directives.get('connect-src'), "'none'");
  assert.equal(directives.get('frame-src'), 'about:');
  assert.equal(directives.get('img-src'), 'data:');
  assert.equal(directives.get('font-src'), 'data:');
  // The generated document is inline script and inline style, and inherits this
  // policy through `srcdoc`; nothing beyond that is allowed.
  assert.equal(directives.get('script-src'), "'unsafe-inline'");
  assert.equal(directives.get('style-src'), "'unsafe-inline'");
  assert.equal(CANVAS_PREVIEW_CSP.includes('unsafe-eval'), false);
  assert.equal(/https?:|\*/.test(CANVAS_PREVIEW_CSP), false);
});

test('the served document carries a sandboxed frame and no closable inline script', () => {
  const document = canvasPreviewDocument();

  assert.match(document, /<iframe sandbox="allow-scripts" referrerpolicy="no-referrer"/);
  assert.equal(document.includes('allow-same-origin'), false);
  // The intermediate's own script holds the in-frame reporter as a JSON literal
  // with `<` escaped, and writes the tags it wraps it in as JS escapes, so the
  // document has exactly one script element and nothing inside it can end it.
  assert.equal(document.split('<script').length, 2);
  assert.equal(document.split('</script>').length, 2);
});

test('main terminates a guest it attached without asking the guest', () => {
  const { hosts, logged } = createHosts();
  const guest = createGuest(7);

  hosts.attach(guest);

  assert.deepEqual(guest.windowOpenHandler({ url: 'https://example.invalid/' }), {
    action: 'deny',
  });
  assert.equal(hosts.terminate(7), true);
  assert.equal(guest.crashes, 1);
  assert.match(logged.join('\n'), /Ending preview guest 7: the renderer asked for it/);
});

test('main refuses a guest ID it never attached', () => {
  const { hosts } = createHosts();
  const guest = createGuest(7);

  hosts.attach(guest);

  assert.equal(hosts.terminate(8), false);
  assert.equal(guest.crashes, 0);
});

test("main's own watchdog ends an unresponsive guest", () => {
  const { hosts, logged } = createHosts();
  const guest = createGuest(11);

  hosts.attach(guest);
  guest.emit('unresponsive');

  assert.equal(guest.crashes, 1);
  assert.match(logged.join('\n'), /Ending preview guest 11: unresponsive/);
  // Already ended, so a later renderer request has nothing left to end.
  assert.equal(hosts.terminate(11), false);
});

test('a guest that is gone or destroyed leaves the registry', () => {
  const { hosts } = createHosts();
  const gone = createGuest(2);
  const destroyed = createGuest(3);

  hosts.attach(gone);
  hosts.attach(destroyed);
  gone.emit('render-process-gone', {}, { reason: 'killed' });
  destroyed.emit('destroyed');

  assert.equal(hosts.terminate(2), false);
  assert.equal(hosts.terminate(3), false);
});

test('a destroyed guest is reported as owned but never crashed again', () => {
  const { hosts } = createHosts();
  const guest = createGuest(5);

  hosts.attach(guest);
  guest.destroyed = true;

  assert.equal(hosts.terminate(5), true);
  assert.equal(guest.crashes, 0);
});

test('the guest refuses navigation away from the owned source', () => {
  const { hosts } = createHosts();
  const guest = createGuest(9);
  hosts.attach(guest);

  const blocked = { prevented: false, preventDefault: () => (blocked.prevented = true) };
  const allowed = { prevented: false, preventDefault: () => (allowed.prevented = true) };
  guest.emit('will-navigate', blocked, 'https://example.invalid/');
  guest.emit('will-navigate', allowed, CANVAS_PREVIEW_URL);

  assert.equal(blocked.prevented, true);
  assert.equal(allowed.prevented, false);
});
