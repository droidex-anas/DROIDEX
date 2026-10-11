const test = require('node:test');
const assert = require('node:assert');

const {
  runWithWebContentsDebugger,
  holdWebContentsDebugger,
} = require('./nativeBrowserEmulation.cjs');

function createContents() {
  const calls = [];
  let attached = false;
  return {
    calls,
    isDestroyed: () => false,
    debugger: {
      isAttached: () => attached,
      attach(version) {
        attached = true;
        calls.push(['attach', version]);
      },
      detach() {
        attached = false;
        calls.push(['detach']);
      },
      async sendCommand(method, params) {
        calls.push(['sendCommand', method, params]);
        return {};
      },
    },
  };
}

test('debugger operations are serialized and detach after each operation', async () => {
  const contents = createContents();
  let releaseFirst;
  const firstBlocked = new Promise((resolve) => {
    releaseFirst = resolve;
  });
  let markFirstStarted;
  const firstStarted = new Promise((resolve) => {
    markFirstStarted = resolve;
  });

  const first = runWithWebContentsDebugger(contents, async () => {
    contents.calls.push(['first-start']);
    markFirstStarted();
    await firstBlocked;
    contents.calls.push(['first-end']);
  });
  const second = runWithWebContentsDebugger(contents, async () => {
    contents.calls.push(['second']);
  });

  await firstStarted;
  assert.deepEqual(contents.calls, [['attach', '1.3'], ['first-start']]);
  releaseFirst();
  await Promise.all([first, second]);
  assert.deepEqual(contents.calls, [
    ['attach', '1.3'],
    ['first-start'],
    ['first-end'],
    ['detach'],
    ['attach', '1.3'],
    ['second'],
    ['detach'],
  ]);
});

test('a failed operation detaches and does not block the next action', async () => {
  const contents = createContents();
  await assert.rejects(
    runWithWebContentsDebugger(contents, () => {
      throw new Error('Action failed');
    }),
    /Action failed/,
  );
  assert.equal(contents.debugger.isAttached(), false);
  assert.equal(await runWithWebContentsDebugger(contents, () => 'next'), 'next');
  assert.equal(contents.debugger.isAttached(), false);
});

test('emulation and preview holds keep the debugger until both owners release it', async () => {
  const contents = createContents();
  const releaseDevice = holdWebContentsDebugger(contents);
  const releasePreview = holdWebContentsDebugger(contents);
  await runWithWebContentsDebugger(contents, () => {});
  await new Promise(setImmediate);
  assert.equal(contents.debugger.isAttached(), true);
  releaseDevice();
  releaseDevice();
  assert.equal(contents.debugger.isAttached(), true);
  releasePreview();
  assert.equal(contents.debugger.isAttached(), false);
});

test('a timed-out operation cannot detach or send input during its replacement', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const contents = createContents();
  let resumeFirst;
  let firstHolding;
  const first = runWithWebContentsDebugger(contents, async (_dbg, holding) => {
    firstHolding = holding;
    await new Promise((resolve) => (resumeFirst = resolve));
    assert.equal(holding(), false);
  });
  await new Promise(setImmediate);
  t.mock.timers.tick(15_000);
  await new Promise(setImmediate);
  assert.equal(firstHolding(), false);
  assert.equal(contents.debugger.isAttached(), false);

  let resumeSecond;
  const second = runWithWebContentsDebugger(
    contents,
    () => new Promise((resolve) => (resumeSecond = resolve)),
  );
  await new Promise(setImmediate);
  resumeFirst();
  await first;
  assert.equal(contents.debugger.isAttached(), true);
  resumeSecond();
  await second;
  assert.equal(contents.debugger.isAttached(), false);
});

test('an existing debugger attachment belongs to its original owner', async () => {
  const contents = createContents();
  contents.debugger.attach('1.3');
  await runWithWebContentsDebugger(contents, () => {});
  assert.equal(contents.debugger.isAttached(), true);
});

test('destroyed web contents skip debugger operations', async () => {
  let invoked = false;
  const result = await runWithWebContentsDebugger(
    {
      isDestroyed: () => true,
      debugger: null,
    },
    () => {
      invoked = true;
    },
  );

  assert.equal(result, undefined);
  assert.equal(invoked, false);
});
