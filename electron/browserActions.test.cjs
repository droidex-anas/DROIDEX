const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const test = require('node:test');
const { createBrowserActions } = require('./browserActions.cjs');
const { documentFrames } = require('./browserFrames.cjs');
const { runWithWebContentsDebugger } = require('./nativeBrowserEmulation.cjs');

function crossFramePage() {
  const contents = new EventEmitter();
  const dbg = new EventEmitter();
  let attachment = 0;
  let attached = false;
  let scrolled = false;
  const inputs = [];
  Object.assign(dbg, {
    isAttached: () => attached,
    attach() {
      attached = true;
      attachment += 1;
    },
    detach() {
      attached = false;
      dbg.emit('detach');
    },
    async sendCommand(method, params, sessionId) {
      const childSession = `child-${attachment}`;
      if (!attached || (sessionId && sessionId !== childSession))
        throw new Error('Detached CDP session');
      if (method === 'Target.setAutoAttach' && !sessionId)
        dbg.emit('message', {}, 'Target.attachedToTarget', {
          sessionId: childSession,
          targetInfo: { type: 'iframe', targetId: 'child' },
        });
      if (method === 'Page.getFrameTree')
        return {
          frameTree: {
            frame: {
              id: sessionId ? 'child' : 'root',
              loaderId: sessionId ? 'child-document' : 'root-document',
            },
          },
        };
      if (method === 'Runtime.evaluate') return { result: { value: scrolled ? '100' : '0' } };
      if (method === 'Input.dispatchMouseEvent') {
        scrolled = true;
        inputs.push(params);
      }
      return {};
    },
  });
  Object.assign(contents, {
    debugger: dbg,
    isDestroyed: () => false,
    getURL: () => 'https://example.test/',
    getTitle: () => 'Example',
    navigationHistory: { canGoBack: () => false, canGoForward: () => false },
  });
  return { contents, inputs };
}

test('cross-frame scroll targets survive debugger detach between lookup and input', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { contents, inputs } = crossFramePage();
  const actions = createBrowserActions({
    reading: {
      pointForRef: () =>
        runWithWebContentsDebugger(contents, async (dbg) => {
          const frame = (await documentFrames(dbg)).find((item) => item.id === 'child');
          return {
            x: 10,
            y: 20,
            local: { x: 10, y: 20 },
            document: frame.loaderId,
            sessionId: frame.sessionId,
          };
        }),
    },
    runWithWebContentsDebugger,
    unthrottled: (_contents, run) => run(),
    redactUrl: (url) => url,
    onPoint() {},
  });
  const action = actions.act(
    contents,
    { errorTimes: [] },
    {
      action: 'scroll',
      ref: 'e1',
      direction: 'down',
      pixels: 100,
      startBy: Number.MAX_SAFE_INTEGER,
      runEnded: () => false,
    },
  );
  // The two animation polls observe movement, then its settled position.
  await new Promise(setImmediate);
  t.mock.timers.tick(40);
  await new Promise(setImmediate);
  t.mock.timers.tick(40);
  const result = await action;
  assert.equal(result.ok, true);
  assert.equal(inputs.length, 1);
  assert.equal(inputs[0].type, 'mouseWheel');
  assert.equal(inputs[0].deltaY, 100);
  assert.equal(contents.debugger.isAttached(), false);
});
