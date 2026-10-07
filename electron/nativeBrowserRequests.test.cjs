const assert = require('node:assert/strict');
const test = require('node:test');
const { createNativeBrowserRequests } = require('./nativeBrowserRequests.cjs');

function fixture() {
  const actions = [];
  const events = [];
  let enabled = true;
  const manager = {
    waitForPaint: async () => {},
    waitForPage: async () => {},
    open: async (_id, _url, before) => {
      before();
      actions.push('open');
    },
    close: () => actions.push('close'),
    abandonWork: () => {},
    runAgentAction: async (request) => {
      actions.push(request.action);
      return { ok: true, snapshot: { url: 'https://example.test/', scroll: { x: 0, y: 0 } } };
    },
  };
  const requests = createNativeBrowserRequests({
    manager,
    notifyRenderer: (channel, payload) => events.push({ channel, ...payload }),
    assertAgentAccess: () => {
      if (!enabled)
        throw new Error('Agent browser access is off. Enable it in Settings > Browser.');
    },
  });
  let sequence = 0;
  async function send(action, initiator = 'agent') {
    const id = `request-${++sequence}`;
    let reply;
    await requests.handle(
      {
        type: 'browser.request',
        id,
        request: {
          requestId: id,
          appSessionId: 'app',
          browserSessionId: 'browser',
          action,
          initiator,
        },
      },
      (message) => (reply = message.result),
      () => false,
    );
    return reply;
  }
  return { manager, actions, events, requests, send, disable: () => (enabled = false) };
}

test('disabled agent requests cannot wake pages or read diagnostics, while closing stays available', async () => {
  const { actions, events, send, disable } = fixture();
  disable();
  for (const action of ['open', 'click', 'readPage', 'network', 'evaluate', 'fillCredentials']) {
    const reply = await send(action);
    assert.equal(reply.ok, false);
    assert.match(reply.error, /Agent browser access is off/);
  }
  assert.deepEqual(actions, []);
  assert.deepEqual(events, []);
  assert.equal((await send('close')).ok, true);
  assert.deepEqual(actions, ['close']);
});

test('user navigation stays available when agent access is off', async () => {
  const { actions, send, disable } = fixture();
  disable();
  assert.equal((await send('open', 'user')).ok, true);
  assert.deepEqual(actions, ['open', 'snapshot']);
});

test('disabling agent access stops input already waiting on a page to paint', async () => {
  const { manager, actions, requests, send, disable } = fixture();
  const paint = Promise.withResolvers();
  manager.waitForPaint = () => paint.promise;
  const clicking = send('click');
  disable();
  paint.resolve();
  const reply = await clicking;
  assert.equal(reply.ok, false);
  assert.match(reply.error, /Agent browser access is off/);
  assert.deepEqual(actions, []);
  assert.deepEqual(requests.workingSessions(), []);
});
