const test = require('node:test');
const assert = require('node:assert/strict');

const {
  CANVAS_PREVIEW_CSP,
  CANVAS_PREVIEW_PARTITION,
  CANVAS_PREVIEW_URL,
  canvasPreviewDocument,
  configureCanvasPreviewSession,
  createCanvasPreviewHosts,
} = require('./canvasPreview.cjs');

/** The design's frame, whose every probe is a promise the test settles. */
function createGeneratedFrame() {
  const probes = [];
  return {
    probes,
    executeJavaScript(code) {
      return new Promise((resolve, reject) => {
        probes.push({ code, settle: resolve, fail: () => reject(new Error('frame gone')) });
      });
    },
  };
}

function createGuest(id, frames = []) {
  const listeners = new Map();
  return {
    id,
    crashes: 0,
    destroyed: false,
    windowOpenHandler: null,
    webRtcPolicy: null,
    mainFrame: { frames },
    isDestroyed() {
      return this.destroyed;
    },
    setWebRTCIPHandlingPolicy(policy) {
      this.webRtcPolicy = policy;
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

/** Timers a test fires itself; nothing here waits on wall-clock time. */
function createClock() {
  const intervals = new Set();
  const deadlines = new Set();
  return {
    clock: {
      schedule(task, delayMs) {
        const entry = { task, delayMs };
        deadlines.add(entry);
        return () => deadlines.delete(entry);
      },
      repeat(task, everyMs) {
        const entry = { task, everyMs };
        intervals.add(entry);
        return () => intervals.delete(entry);
      },
    },
    pending: () => ({ intervals: intervals.size, deadlines: deadlines.size }),
    /** One turn of every live probe interval. */
    tick() {
      for (const entry of [...intervals]) entry.task();
    },
    /** Fires every deadline that is still waiting. */
    expire() {
      for (const entry of [...deadlines]) {
        deadlines.delete(entry);
        entry.task();
      }
    },
  };
}

function createHosts() {
  const logged = [];
  const clock = createClock();
  return {
    hosts: createCanvasPreviewHosts({ log: (message) => logged.push(message), clock: clock.clock }),
    logged,
    clock,
  };
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

test('the guest loses every network path at its own session', async () => {
  const { hosts } = createHosts();
  const guest = createGuest(21);
  hosts.attach(guest);

  // CSP cannot bound WebRTC: `connect-src` does not govern ICE, and Chromium
  // never shipped the `webrtc` directive. Claiming it would be a lie.
  assert.equal(CANVAS_PREVIEW_CSP.includes('webrtc'), false);
  assert.equal(guest.webRtcPolicy, 'disable_non_proxied_udp');

  const configured = { handled: [], proxy: null, requested: [], checked: null };
  await configureCanvasPreviewSession(
    {
      protocol: {
        handle(scheme, serve) {
          configured.handled.push({ scheme, serve });
        },
      },
      setProxy(proxy) {
        configured.proxy = proxy;
        return Promise.resolve();
      },
      setPermissionRequestHandler(handler) {
        handler({}, 'media', (allowed) => configured.requested.push(allowed));
        handler({}, 'clipboard-read', (allowed) => configured.requested.push(allowed));
      },
      setPermissionCheckHandler(handler) {
        configured.checked = handler({}, 'media', 'droidex-canvas-preview://preview', {});
      },
    },
    'serve',
  );

  // The owned scheme is served on the guest's session; nothing else is.
  assert.deepEqual(configured.handled, [{ scheme: 'droidex-canvas-preview', serve: 'serve' }]);
  // Every TCP connection, including WebRTC's P2P sockets, goes to a dead proxy,
  // and loopback is explicitly not bypassed.
  assert.deepEqual(configured.proxy, {
    mode: 'fixed_servers',
    proxyRules: 'http://127.0.0.1:1',
    proxyBypassRules: '<-loopback>',
  });
  assert.deepEqual(configured.requested, [false, false]);
  assert.equal(configured.checked, false);
  // In memory only: a `persist:` partition would keep storage for generated code.
  assert.equal(CANVAS_PREVIEW_PARTITION.startsWith('persist:'), false);
});

test('main ends a guest whose design stops answering, one probe at a time', () => {
  const { hosts, logged, clock } = createHosts();
  const frame = createGeneratedFrame();
  const guest = createGuest(31, [frame]);
  hosts.attach(guest);

  clock.tick();
  clock.tick();

  // One probe in flight, and it asks the frame for a literal, not a heartbeat.
  assert.equal(frame.probes.length, 1);
  assert.equal(frame.probes[0].code, '0');
  clock.expire();

  assert.equal(guest.crashes, 1);
  assert.match(logged.join('\n'), /Ending preview guest 31: its design stopped responding/);
  // The probe timers went with the guest, and a late answer reaches nothing.
  assert.deepEqual(clock.pending(), { intervals: 0, deadlines: 0 });
  frame.probes[0].settle(0);
});

test('a design that keeps answering is probed again and never ended', () => {
  const { hosts, clock } = createHosts();
  const frame = createGeneratedFrame();
  const guest = createGuest(32, [frame]);
  hosts.attach(guest);

  clock.tick();
  frame.probes[0].settle(0);
  return Promise.resolve().then(() => {
    // The answered probe released its deadline rather than ending the guest.
    assert.deepEqual(clock.pending(), { intervals: 1, deadlines: 0 });
    clock.expire();
    assert.equal(guest.crashes, 0);
    clock.tick();
    assert.equal(frame.probes.length, 2);
  });
});

test('a guest with no design mounted yet is probed, not ended', () => {
  const { hosts, clock } = createHosts();
  const guest = createGuest(33);
  hosts.attach(guest);

  clock.tick();
  clock.expire();

  assert.equal(guest.crashes, 0);
  assert.deepEqual(clock.pending(), { intervals: 1, deadlines: 0 });
});

test('a guest that goes away releases its probe timers', () => {
  const { hosts, clock } = createHosts();
  const gone = createGuest(34, [createGeneratedFrame()]);
  const destroyed = createGuest(35, [createGeneratedFrame()]);
  hosts.attach(gone);
  hosts.attach(destroyed);
  clock.tick();
  assert.deepEqual(clock.pending(), { intervals: 2, deadlines: 2 });

  gone.emit('render-process-gone', {}, { reason: 'killed' });
  destroyed.emit('destroyed');

  assert.deepEqual(clock.pending(), { intervals: 0, deadlines: 0 });
});

test('the intermediate measures its message cap in bytes', () => {
  const document = canvasPreviewDocument();

  // A code-unit cap would accept four times the bytes it names.
  assert.match(document, /new TextEncoder\(\)/);
  assert.match(document, /bytes\(encoded\) > 4096/);
  assert.equal(/encoded\.length >/.test(document), false);
});
