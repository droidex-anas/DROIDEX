// Readies main.cjs under the mainBootEval electron stub, then either calls its
// IPC handlers as the main window's top frame and as renderers they must reject,
// or (argv[2] === 'window') checks the main window's guards and teardown.
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createElectronStub, installElectronStub } = require('./mainBootEval.cjs');
const { preferenceFilePath } = require('./hardwareAcceleration.cjs');
const { LOCAL_IMAGE_SCHEME } = require('./localImages.cjs');

const SENTINEL = 'MAIN_IPC_EVAL_OK';
const REJECTED = 'Desktop request rejected for unknown renderer.';
const PASSED = 'passed the sender check';
const PR_WORKSPACE_OPERATIONS = {
  'github-detect-pr': 'detectPr',
  'github-list-prs': 'listPrs',
  'github-view-pr': 'viewPr',
  'github-pr-diff': 'prDiff',
  'github-pr-checks': 'prChecks',
  'github-pr-comments': 'prComments',
  'github-create-pr': 'createPr',
  'github-post-comment': 'postComment',
  'github-merge-pr': 'mergePr',
};

// Browser pane pages send these through nativeBrowserPreload.cjs, so they
// cannot require the main window.
const BROWSER_PANE_CHANNELS = [
  'native-browser-selection',
  'native-browser-design-prompt',
  'native-browser-agent-result',
  'native-browser-credential-capture',
];

function createBrowserWindowStub() {
  const created = Promise.withResolvers();
  const windows = [];
  class BrowserWindow extends EventEmitter {
    constructor() {
      super();
      windows.push(this);
      this.webContents = new EventEmitter();
      this.webContents.mainFrame = {};
      this.webContents.send = () => {};
      this.webContents.setWindowOpenHandler = () => {};
      created.resolve(this);
    }
    loadFile() {}
    loadURL() {}
    isDestroyed() {
      return false;
    }
    isVisible() {
      return true;
    }
    isMinimized() {
      return false;
    }
    show() {}
    focus() {}
    restore() {}
    setIcon() {}
  }
  return { BrowserWindow, created: created.promise, windows };
}

// Guards run before a handler's first await, so even an async handler has
// rejected once the queued microtasks drain. Nothing here yields to the event
// loop, so a handler that gets past its guard never reaches its I/O.
async function senderCheck(handler, event) {
  const posted = [];
  // A listener that owns a MessagePort reports its rejection on the port.
  const port = { postMessage: (message) => posted.push(message.message), close() {} };
  let rejection;
  try {
    // Handlers destructure their payload before the guard runs, so pass an empty one.
    Promise.resolve(handler({ ...event, ports: [port] }, {})).catch((error) => {
      rejection = error.message;
    });
  } catch (error) {
    return error.message;
  }
  await null;
  return rejection ?? posted[0] ?? PASSED;
}

// Records what main.cjs asks of the modules that would spawn gh or ptys, and of
// app lifecycle calls Electron only honours before ready.
function observeMain(electron) {
  const calls = [];
  const boot = { privilegedSchemes: [], protocolHandlers: new Map() };
  let ready = false;
  const beforeReady = (name) => {
    if (ready) throw new Error(`${name} must be called before the app is ready`);
  };
  electron.app.whenReady = () => Promise.resolve().then(() => (ready = true));
  electron.app.disableHardwareAcceleration = () => {
    beforeReady('app.disableHardwareAcceleration');
    boot.hardwareAccelerationDisabled = true;
  };
  electron.app.relaunch = () => calls.push('relaunch');
  electron.protocol.registerSchemesAsPrivileged = (schemes) => {
    beforeReady('protocol.registerSchemesAsPrivileged');
    boot.privilegedSchemes.push(...schemes.map((entry) => entry.scheme));
  };
  // Only default-session handlers are recorded: web pages in other partitions must not reach them.
  electron.session.defaultSession.protocol = {
    handle: (scheme, handler) => boot.protocolHandlers.set(scheme, handler),
  };

  const github = require('./github.cjs');
  const conversation = require('./githubPrConversation.cjs');
  for (const operation of Object.values(PR_WORKSPACE_OPERATIONS)) {
    const owner = operation === 'prComments' ? conversation : github;
    owner[operation] = async () => calls.push(operation);
  }
  github.authenticate = async ({ onDeviceCode }) => onDeviceCode('ABCD-1234');
  github.cancelSetup = () => calls.push('cancel GitHub setup');
  const terminal = require('./terminal.cjs');
  const createTerminalManager = terminal.createTerminalManager;
  terminal.createTerminalManager = (options) => {
    const manager = createTerminalManager(options);
    const closeAll = manager.closeAll;
    manager.closeAll = () => {
      calls.push('close terminals');
      closeAll();
    };
    return manager;
  };
  return { calls, boot };
}

/**
 * The guest session every preview attaches into. Memoized the way Electron
 * memoizes a partition, because readiness is a property of that one session
 * object, and `setProxy` is held until a test releases it.
 */
function createGuestSessionStub() {
  const proxy = Promise.withResolvers();
  const calls = { proxy: 0 };
  const guestSession = {
    protocol: { handle() {} },
    webRequest: { onBeforeRequest() {} },
    setProxy() {
      calls.proxy += 1;
      return proxy.promise;
    },
    setPermissionRequestHandler() {},
    setPermissionCheckHandler() {},
  };
  return { guestSession, release: proxy.resolve, calls };
}

/** Lets the main module's startup chain run until `done()` or the turns run out. */
async function settle(done, label) {
  for (let turn = 0; turn < 200; turn += 1) {
    if (done()) return;
    await new Promise((resolve) => setImmediate(resolve));
  }
  assert.fail(`timed out waiting for ${label}`);
}

async function bootMain(options = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'droidex-ipc-eval-'));
  process.on('exit', () => fs.rmSync(root, { recursive: true, force: true }));
  const userData = path.join(root, 'profile');
  fs.mkdirSync(userData);
  fs.writeFileSync(preferenceFilePath(userData), JSON.stringify({ version: 1, enabled: false }));
  const sidecarEntry = path.join(root, 'sidecar.cjs');
  // Never reports ready, and exits once the supervisor's stdin pipe closes.
  fs.writeFileSync(sidecarEntry, 'process.stdin.resume();\n');
  // Even a handler that slips past its guard must not reach the real home directory.
  process.env.HOME = root;
  process.env.DROIDEX_USER_DATA_DIR = userData;
  process.env.SIDECAR_ENTRY = sidecarEntry;
  delete process.env.SENTRY_DSN;
  delete process.env.ELECTRON_START_URL;

  const electron = createElectronStub({
    appRoot: path.resolve(__dirname, '..'),
    userData,
    version: '0.0.0',
  });
  const channels = new Map();
  const register = (channel, handler) => channels.set(channel, handler);
  electron.ipcMain.handle = register;
  electron.ipcMain.on = register;
  const { BrowserWindow, created, windows } = createBrowserWindowStub();
  electron.BrowserWindow = BrowserWindow;
  electron.Menu = { buildFromTemplate: () => ({ popup() {} }), setApplicationMenu() {} };
  electron.session.defaultSession.getUserAgent = () => 'DROIDEX';
  const observed = observeMain(electron);
  // Owned here rather than in `observeMain`: a startup check holds its `setProxy`.
  const guest = options.guestSession ?? createGuestSessionStub();
  if (!options.guestSession) guest.release();
  electron.session.fromPartition = () => guest.guestSession;
  installElectronStub(electron, path.join(root, 'resources'));
  require('./main.cjs');
  if (options.deferWindow) return { electron, channels, windows, guest, root, ...observed };
  return { electron, channels, mainWindow: await created, windows, guest, root, ...observed };
}

/**
 * A window — and therefore a guest — must not exist before the preview session's
 * network is off, and an `activate` that arrives during startup must wait for the
 * same setup rather than race it into a second window.
 */
async function checkStartupOrder() {
  const guest = createGuestSessionStub();
  const booted = await bootMain({ guestSession: guest, deferWindow: true });

  await settle(() => guest.calls.proxy === 1, 'the preview session to be configured');
  assert.deepEqual(
    booted.windows,
    [],
    'a window existed before the preview session was configured',
  );

  booted.electron.app.emit('activate');
  await settle(() => true, 'activate');
  assert.deepEqual(
    booted.windows,
    [],
    'activate opened a window before the session was configured',
  );

  guest.release();
  await settle(() => booted.windows.length > 0, 'the app window');
  assert.equal(booted.windows.length, 1, 'startup and activate both opened a window');

  booted.electron.app.emit('activate');
  await settle(() => true, 'activate after startup');
  assert.equal(booted.windows.length, 1, 'activate opened a second window');
}

async function checkSenders({ channels, mainWindow }) {
  const mainFrameEvent = {
    sender: mainWindow.webContents,
    senderFrame: mainWindow.webContents.mainFrame,
  };
  assert.equal(await senderCheck(channels.get('bridge-info'), mainFrameEvent), PASSED);

  assert.deepEqual(
    BROWSER_PANE_CHANNELS.filter((channel) => !channels.has(channel)),
    [],
    'Browser pane channels that main.cjs no longer registers',
  );
  const foreignSenders = {
    'another renderer': { sender: new EventEmitter(), senderFrame: {} },
    'a main window subframe': { sender: mainWindow.webContents, senderFrame: {} },
  };
  const accepted = [];
  for (const [channel, handler] of channels) {
    if (BROWSER_PANE_CHANNELS.includes(channel)) continue;
    for (const [senderName, event] of Object.entries(foreignSenders)) {
      const outcome = await senderCheck(handler, event);
      if (outcome !== REJECTED) accepted.push(`${channel} from ${senderName}: ${outcome}`);
    }
  }
  assert.deepEqual(accepted, [], 'IPC handlers that did not reject a foreign sender');
}

async function checkMainWindow({ electron, channels, mainWindow, root, calls, boot }) {
  const contents = mainWindow.webContents;
  const call = (channel, payload) =>
    channels.get(channel)({ sender: contents, senderFrame: contents.mainFrame }, payload);

  assert.equal(boot.hardwareAccelerationDisabled, true, 'saved GPU preference ignored at boot');
  assert.ok(boot.privilegedSchemes.includes(LOCAL_IMAGE_SCHEME));
  const svgPath = path.join(root, 'shot.svg');
  fs.writeFileSync(svgPath, '<svg xmlns="http://www.w3.org/2000/svg"/>');
  const image = await boot.protocolHandlers.get(LOCAL_IMAGE_SCHEME)({
    url: `${LOCAL_IMAGE_SCHEME}://image?p=${encodeURIComponent(svgPath)}`,
  });
  assert.equal(
    image.headers.get('content-security-policy'),
    "default-src 'none'; style-src 'unsafe-inline'",
  );
  assert.equal(image.headers.get('x-content-type-options'), 'nosniff');

  let prevented = false;
  contents.emit('will-navigate', { preventDefault: () => (prevented = true) }, 'https://x.test/');
  assert.equal(prevented, true, 'the main window navigated away from the app');

  for (const channel of Object.keys(PR_WORKSPACE_OPERATIONS)) {
    for (const dir of [undefined, 42, '  ']) {
      assert.equal((await call(channel, { dir })).ok, false, `${channel} with dir ${dir}`);
    }
  }
  await call('hardware-acceleration-preference-set', { enabled: true });
  await call('diagnostics-preference-set', { enabled: false });
  assert.deepEqual(calls, [], 'invalid PR requests or preference changes reached an operation');

  const icons = [];
  mainWindow.setIcon = (iconPath) => icons.push(path.basename(iconPath));
  assert.throws(() => call('app-set-icon', { mode: 'sepia' }), /light, dark, or system/);
  electron.nativeTheme.shouldUseDarkColors = true;
  call('app-set-icon', { mode: 'system' });
  electron.nativeTheme.shouldUseDarkColors = false;
  electron.nativeTheme.emit('updated');
  call('app-set-icon', { mode: 'dark' });
  electron.nativeTheme.emit('updated');
  assert.deepEqual(icons, ['icon-dark.png', 'icon.png', 'icon-dark.png']);

  const deviceCodes = [];
  contents.send = (channel, payload) => channel === 'github-auth-code' && deviceCodes.push(payload);
  contents.isDestroyed = () => false;
  await call('github-authenticate');
  assert.deepEqual(deviceCodes, [{ code: 'ABCD-1234' }]);

  // The window closes last: afterwards main.cjs has no main window to address.
  const teardowns = {
    'renderer navigation': () => contents.emit('will-frame-navigate', {}, 'x', false, true),
    'renderer crash': () => contents.emit('render-process-gone', {}, { reason: 'crashed' }),
    'app quit': () => electron.app.emit('before-quit'),
    'window close': () => mainWindow.emit('closed'),
  };
  for (const [name, tearDown] of Object.entries(teardowns)) {
    contents.emit('did-finish-load');
    calls.length = 0;
    tearDown();
    assert.deepEqual(calls, ['cancel GitHub setup', 'close terminals'], name);
  }
}

module.exports = { SENTINEL };

if (require.main === module) {
  const checks = { window: checkMainWindow, startup: checkStartupOrder };
  const check = checks[process.argv[2]] ?? checkSenders;
  // Exit once the checks settle: the sidecar stub holds the event loop open, and
  // a handler that got past its sender guard must not reach its I/O.
  (process.argv[2] === 'startup' ? check() : bootMain().then(check)).then(
    () => {
      process.stdout.write(`${SENTINEL}\n`);
      process.exit(0);
    },
    (error) => {
      console.error(error);
      process.exit(1);
    },
  );
}
