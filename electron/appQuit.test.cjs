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
    lifecycle: 'healthy',
    stopping: false,
    isReady: () => sidecar.lifecycle === 'healthy',
    isStopping: () => sidecar.stopping,
    snapshot: () => ({ lifecycle: sidecar.lifecycle }),
    workingSessionCount: async () => {
      if (sidecar.working instanceof Error) throw sidecar.working;
      return sidecar.working;
    },
    stop: () => {
      calls.push('stop sidecar');
      sidecar.lifecycle = 'stopped';
      sidecar.stopping = true;
      return stopped.promise.then(() => {
        sidecar.stopping = false;
      });
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

test('a second quit while the sidecar stops still waits for it to exit', async () => {
  const { app, calls, finishStop } = harness({ working: 0 });
  app.quit();
  await settle();
  app.quit();
  await settle();
  assert.deepEqual(calls, ['quit', 'stop sidecar', 'quit']);

  finishStop();
  await settle();
  assert.deepEqual(calls, [
    'quit',
    'stop sidecar',
    'quit',
    'quit',
    'close services',
    'stop sidecar',
    'exit',
  ]);
});

test('a sidecar started while a confirmed quit waits is stopped before the app exits', async () => {
  const { app, sidecar, calls, finishStop } = harness({ working: 1, answer: 1 });
  app.quit();
  await settle();
  sidecar.lifecycle = 'starting';
  finishStop();
  await settle();
  assert.deepEqual(calls, [
    'quit',
    'stop sidecar',
    'stop sidecar',
    'quit',
    'close services',
    'stop sidecar',
    'exit',
  ]);
});

test('a quit asks first when the sidecar cannot say whether agents work', async () => {
  const { app, calls, dialogs } = harness({ working: new Error('timed out'), answer: 0 });
  app.quit();
  await settle();
  assert.deepEqual(dialogs, ['Agents may still be working']);
  assert.deepEqual(calls, ['quit', 'open window']);
});

test('closing the last window on macOS keeps the sidecar until its agents finish', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { app, sidecar, calls } = harness({ working: 1, window: null });
  app.emit('window-all-closed');
  await settle();
  assert.deepEqual(calls, []);

  sidecar.working = 0;
  t.mock.timers.tick(30_000);
  await settle();
  assert.deepEqual(calls, ['stop sidecar']);
});
