const assert = require('node:assert/strict');
const test = require('node:test');
const { EventEmitter } = require('node:events');
const { observeNavigation } = require('./browserNavigation.cjs');
const { createBrowserNavigationApproval } = require('./browserNavigationApproval.cjs');

function fixture() {
  const approvals = [];
  const loads = [];
  const loadOptions = [];
  const failures = [];
  const contents = new EventEmitter();
  contents.getURL = () => 'https://start.test/';
  contents.isDestroyed = () => false;
  contents.setWindowOpenHandler = (handler) => {
    contents.popup = handler;
  };
  const entry = { documents: 1, contents };
  let answer = async () => {};
  const gate = createBrowserNavigationApproval({
    authorizeAgentOrigin: async (url, autonomy, signal) => {
      approvals.push({ url, autonomy, signal });
      await answer(signal);
    },
    loadUrl: async (entry, url, options) => {
      loads.push(url);
      loadOptions.push(options);
      gate.recordLoad(entry, contents, url);
    },
    reportFailure: (_entry, url, message) => failures.push({ url, message }),
  });
  gate.bind(entry, contents);
  const request = {
    requestId: 'click-1',
    initiator: 'agent',
    autonomy: 'medium',
    startBy: Infinity,
    runEnded: () => false,
  };
  const dispatch = (send) =>
    gate.dispatch(
      entry,
      contents,
      request,
      { type: 'mousePressed', x: 20, y: 30, button: 'left' },
      send,
    );
  const navigate = (url, id = 1, overrides = {}) =>
    new Promise((resolve) =>
      gate.beforeRequest({ url, id, resourceType: 'mainFrame', ...overrides }, resolve, entry),
    );
  return {
    gate,
    entry,
    contents,
    request,
    approvals,
    loads,
    loadOptions,
    failures,
    dispatch,
    navigate,
    setAnswer: (next) => {
      answer = next;
    },
  };
}

test('a cross-origin form waits for approval and continues its original request without replaying it', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const f = fixture();
  const observer = observeNavigation(f.contents);
  t.after(() => observer.dispose());
  let finished = false;
  const completion = observer.wait().then(() => {
    finished = true;
  });
  const answer = Promise.withResolvers();
  f.setAnswer(() => answer.promise);
  let settled = false;
  let navigation;
  await f.dispatch(async () => {
    f.contents.emit('did-start-navigation', {}, 'https://submit.test/checkout', false, true);
    navigation = f
      .navigate('https://submit.test/checkout', 1, { method: 'POST', uploadData: ['body'] })
      .then((result) => {
        settled = true;
        return result;
      });
  });
  t.mock.timers.tick(7_000);
  await Promise.resolve();
  assert.equal(finished, false);
  assert.equal(settled, false);
  assert.equal(f.approvals[0].autonomy, 'medium');
  assert.deepEqual(f.loads, []);
  answer.resolve();
  assert.deepEqual(await navigation, {});
  assert.deepEqual(f.loads, []);
  assert.deepEqual(await f.navigate('https://submit.test/done', 1), {});
  assert.equal(f.approvals.length, 1);
  await f.navigate('https://redirect.test/', 1);
  assert.equal(f.approvals[1].autonomy, 'medium');
  f.contents.emit('did-finish-load');
  await completion;
  assert.equal(finished, true);
});

test('user input and its redirects bypass approval even while an agent question is pending', async () => {
  const f = fixture();
  const answer = Promise.withResolvers();
  f.setAnswer(() => answer.promise);
  let agent;
  await f.dispatch(async () => {
    agent = f.navigate('https://agent.test/');
  });
  f.contents.emit('before-mouse-event', {}, { type: 'mouseDown', x: 80, y: 40, button: 'left' });
  assert.deepEqual(await f.navigate('https://user.test/', 2), {});
  assert.deepEqual(await f.navigate('https://user-redirect.test/', 2), {});
  assert.equal(f.approvals.length, 1);
  f.entry.documents++;
  f.contents.emit('did-navigate');
  answer.resolve();
  assert.deepEqual(await agent, { cancel: true });
});

test('denials and replaced guests cancel requests and cannot navigate a replacement', async () => {
  const f = fixture();
  f.setAnswer(async () => {
    throw new Error('denied');
  });
  f.entry.targetUrl = 'https://denied.test/';
  await f.dispatch(async () => {
    assert.deepEqual(await f.navigate('https://denied.test/'), { cancel: true });
  });
  assert.throws(() => f.gate.takeFailure(f.contents, f.request.requestId), /denied/);
  assert.equal(f.entry.targetUrl, 'https://start.test/');
  const answer = Promise.withResolvers();
  f.setAnswer(() => answer.promise);
  let navigation;
  await f.dispatch(async () => {
    navigation = f.navigate('https://closed.test/', 2);
  });
  f.entry.targetUrl = 'https://closed.test/';
  f.gate.invalidate(f.contents);
  assert.equal(f.entry.targetUrl, 'https://start.test/');
  f.entry.contents = {};
  assert.equal(f.approvals.at(-1).signal.aborted, true);
  answer.resolve();
  assert.deepEqual(await navigation, { cancel: true });
  assert.deepEqual(f.loads, []);
});

test('direct opens ask once and agent popups and non-http schemes cannot bypass the gate', async () => {
  const f = fixture();
  await f.gate.open(f.entry, f.contents, 'https://open.test', f.request);
  f.gate.recordLoad(f.entry, f.contents, 'https://open.test');
  assert.deepEqual(await f.navigate('https://open.test/'), {});
  assert.equal(f.approvals.length, 1);
  await assert.rejects(
    f.gate.open(f.entry, f.contents, 'file:///tmp/page', f.request),
    /http\(s\)/,
  );
  const data = [{ type: 'rawData', bytes: Buffer.from('example=body') }];
  await f.dispatch(async () => {
    assert.deepEqual(
      f.contents.popup({
        url: 'https://popup.test/',
        postBody: { contentType: 'application/x-www-form-urlencoded', data },
      }),
      { action: 'deny' },
    );
  });
  await f.gate.waitForApprovals(f.contents, f.request.requestId);
  assert.deepEqual(f.loads, ['https://popup.test/']);
  assert.deepEqual(f.loadOptions[0].postData, data);
  assert.equal(
    f.loadOptions[0].extraHeaders,
    'Content-Type: application/x-www-form-urlencoded\r\n',
  );
  await f.navigate('https://popup.test/', 2);
  await f.navigate('https://popup-redirect.test/', 2);
  assert.equal(f.approvals.at(-1).autonomy, 'medium');
  await f.dispatch(async () => {
    f.contents.popup({ url: 'javascript:alert(1)' });
  });
  await assert.rejects(f.gate.waitForApprovals(f.contents, f.request.requestId), /http\(s\)/);
  assert.deepEqual(f.loads, ['https://popup.test/']);
});
