// Readies main.cjs under the mainBootEval electron stub, then calls its IPC
// handlers as the main window's top frame and as renderers they must reject.
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createElectronStub, installElectronStub } = require('./mainBootEval.cjs');

const SENTINEL = 'MAIN_IPC_EVAL_OK';
const REJECTED = 'Desktop request rejected for unknown renderer.';
const PASSED = 'passed the sender check';

// Browser pane pages send these through nativeBrowserPreload.cjs, so they
// cannot require the main window.
const BROWSER_PANE_CHANNELS = [
  'native-browser-selection',
  'native-browser-design-prompt',
  'native-browser-agent-result',
  'native-browser-credential-capture',
];

// Unguarded today: these run for any sender. Listed so no new channel joins them unreviewed.
const UNGUARDED_CHANNELS = [
  'pick-directory',
  'pick-files',
  'save-image',
  'save-attachment',
  'discard-image',
  'get-api-key',
  'set-api-key',
  'clear-api-key',
  'list-files',
  'read-file',
  'repo-status',
  'list-editors',
  'editor-icon',
  'open-project',
  'git-environment',
  'git-branches',
  'git-worktrees',
  'git-diff-stat',
  'git-diff-files',
  'git-file-diff',
  'git-mark-turn-start',
  'git-adopt-turn-baseline',
  'git-create-branch',
  'git-checkout',
  'git-create-worktree',
  'git-remove-worktree',
  'git-commit',
  'git-push',
  'git-fetch',
  'onboarding-get',
  'onboarding-set',
  'app-version',
  'app-relaunch',
  'open-external',
];

function createBrowserWindowStub() {
  const created = Promise.withResolvers();
  class BrowserWindow extends EventEmitter {
    constructor() {
      super();
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
    setIcon() {}
  }
  return { BrowserWindow, created: created.promise };
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

async function evaluateIpc() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'droidex-ipc-eval-'));
  process.on('exit', () => fs.rmSync(root, { recursive: true, force: true }));
  const userData = path.join(root, 'profile');
  fs.mkdirSync(userData);
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
  electron.app.whenReady = () => Promise.resolve();
  const { BrowserWindow, created } = createBrowserWindowStub();
  electron.BrowserWindow = BrowserWindow;
  electron.Menu = { buildFromTemplate: () => ({ popup() {} }), setApplicationMenu() {} };
  electron.session.defaultSession.getUserAgent = () => 'DROIDEX';
  installElectronStub(electron, path.join(root, 'resources'));
  require('./main.cjs');
  const mainWindow = await created;

  const mainFrameEvent = {
    sender: mainWindow.webContents,
    senderFrame: mainWindow.webContents.mainFrame,
  };
  assert.equal(await senderCheck(channels.get('bridge-info'), mainFrameEvent), PASSED);

  const exempt = [...BROWSER_PANE_CHANNELS, ...UNGUARDED_CHANNELS];
  assert.deepEqual(
    exempt.filter((channel) => !channels.has(channel)),
    [],
    'exempt channels that main.cjs no longer registers',
  );
  const foreignSenders = {
    'another renderer': { sender: new EventEmitter(), senderFrame: {} },
    'a main window subframe': { sender: mainWindow.webContents, senderFrame: {} },
  };
  const accepted = [];
  for (const [channel, handler] of channels) {
    if (exempt.includes(channel)) continue;
    for (const [senderName, event] of Object.entries(foreignSenders)) {
      const outcome = await senderCheck(handler, event);
      if (outcome !== REJECTED) accepted.push(`${channel} from ${senderName}: ${outcome}`);
    }
  }
  assert.deepEqual(accepted, [], 'IPC handlers that did not reject a foreign sender');
  process.stdout.write(`${SENTINEL}\n`);
}

module.exports = { SENTINEL };

if (require.main === module) {
  // Exit without turning the event loop: the sidecar stub holds it open, and a
  // handler that got past its guard must not reach its I/O.
  evaluateIpc().then(
    () => process.exit(0),
    (error) => {
      console.error(error);
      process.exit(1);
    },
  );
}
