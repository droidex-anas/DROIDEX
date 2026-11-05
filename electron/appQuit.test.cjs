const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { installAppQuit } = require('./appQuit.cjs');

const settle = () => new Promise((resolve) => setImmediate(resolve));

function harness({ working, answer = 0, window = {} }) {
  const calls = [];
  const dialogs = [];
  const stopped = Promise.withResolvers();
  const app = new EventEmitter();
  app.getName = () => 'DROIDEX';
  app.quit = () => {
    calls.push('quit');
    let prevented = false;
    app.emit('before-quit', { preventDefault: () => (prevented = true) });
    if (!prevented) calls.push('exit');
  };
  const sidecar = {
    working,
    isReady: () => true,
    workingSessionCount: async () => sidecar.working,
    stop: () => {
      calls.push('stop sidecar');
      return stopped.promise;
    },
  };
  installAppQuit({
    app,
    dialog: {
      showMessageBox: async (_window, options) => {
        dialogs.push(options.message);
        return { response: answer };
      },
    },
    platform: 'darwin',
    sidecar,
    getMainWindow: () => window,
    openMainWindow: async () => calls.push('open window'),
    keepsSidecarWithoutWindows: () => false,
    closeServices: () => calls.push('close services'),
    logError: () => {},
  });
  return { app, sidecar, calls, dialogs, finishStop: () => stopped.resolve() };
}

test('quitting while agents work asks first, and Cancel leaves the app and its sidecar running', async () => {
  const { app, calls, dialogs } = harness({ working: 2, answer: 0 });
  app.quit();
  await settle();
  assert.deepEqual(dialogs, ['2 agents are still working']);
  assert.deepEqual(calls, ['quit', 'open window']);
});

test('a confirmed quit exits only after the sidecar has stopped', async () => {
  const { app, calls, dialogs, finishStop } = harness({ working: 1, answer: 1 });
  app.quit();
  await settle();
  assert.deepEqual(dialogs, ['An agent is still working']);
  assert.deepEqual(calls, ['quit', 'stop sidecar']);

  finishStop();
  await settle();
  assert.deepEqual(calls, [
    'quit',
    'stop sidecar',
    'quit',
    'close services',
    'stop sidecar',
    'exit',
  ]);
});

test('closing the last window on macOS keeps the sidecar while agents work', async () => {
  const { app, sidecar, calls } = harness({ working: 1, window: null });
  app.emit('window-all-closed');
  await settle();
  assert.deepEqual(calls, []);

  sidecar.working = 0;
  app.emit('window-all-closed');
  await settle();
  assert.deepEqual(calls, ['stop sidecar']);
});
