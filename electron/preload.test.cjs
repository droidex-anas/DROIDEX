const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

function createDomPort() {
  const messageListeners = [];
  return {
    started: false,
    closed: false,
    posted: [],
    start() {
      this.started = true;
    },
    addEventListener(type, listener) {
      if (type === 'message') messageListeners.push(listener);
    },
    postMessage(data) {
      this.posted.push(data);
    },
    close() {
      this.closed = true;
    },
    deliver(data) {
      for (const listener of messageListeners) listener({ data });
    },
  };
}

function loadApi(invokeResult) {
  const calls = [];
  const listeners = [];
  const removedListeners = [];
  const posts = [];
  const channels = [];
  let api;
  const ipcRenderer = {
    invoke(channel, payload) {
      calls.push({ channel, payload });
      return Promise.resolve(invokeResult);
    },
    on(channel, listener) {
      listeners.push({ channel, listener });
    },
    removeListener(channel, listener) {
      removedListeners.push({ channel, listener });
    },
    postMessage(channel, payload, ports) {
      posts.push({ channel, payload, ports });
    },
  };
  const source = readFileSync(path.join(__dirname, 'preload.cjs'), 'utf8');
  vm.runInNewContext(source, {
    Buffer,
    MessageChannel: class MessageChannel {
      constructor() {
        this.port1 = createDomPort();
        this.port2 = createDomPort();
        channels.push(this);
      }
    },
    require(name) {
      if (name !== 'electron') throw new Error(`Unexpected preload dependency: ${name}`);
      return {
        contextBridge: {
          exposeInMainWorld(_name, exposed) {
            api = exposed;
          },
        },
        ipcRenderer,
        webUtils: {
          getPathForFile(file) {
            return typeof file?.path === 'string' ? file.path : '';
          },
        },
      };
    },
  });
  return { api, calls, listeners, removedListeners, posts, channels };
}

// Each row is one exposed method: the channel it invokes and the exact payload
// it sends. Methods that take no renderer input must send no payload at all.
const invokeContract = [
  [
    'notify',
    ['DROIDEX', 'Finished', { silent: true, appSessionId: 'app-1' }],
    'notify',
    { title: 'DROIDEX', body: 'Finished', silent: true, appSessionId: 'app-1' },
  ],
  [
    'nativeBrowserReserve',
    ['browser-1', 'https://example.test'],
    'native-browser-reserve',
    { browserSessionId: 'browser-1', savedUrl: 'https://example.test' },
  ],
  [
    'gitMarkTurnStart',
    ['/repo', 'client-1'],
    'git-mark-turn-start',
    { dir: '/repo', ownerId: 'client-1' },
  ],
  [
    'gitAdoptTurnBaseline',
    ['/repo', 'client-1', 'app-1'],
    'git-adopt-turn-baseline',
    { dir: '/repo', clientRef: 'client-1', appSessionId: 'app-1' },
  ],
  ['setAppIcon', ['dark'], 'app-set-icon', { mode: 'dark' }],
  [
    'saveAttachment',
    ['notes.pdf', 'data:application/pdf;base64,Zg=='],
    'save-attachment',
    { name: 'notes.pdf', dataUrl: 'data:application/pdf;base64,Zg==' },
  ],
  ['setAutomaticDiagnostics', [false], 'diagnostics-preference-set', { enabled: false }],
  ['setHardwareAcceleration', [false], 'hardware-acceleration-preference-set', { enabled: false }],
  ['downloadAppUpdate', [], 'app-download-update', undefined],
  ['getAutomaticDiagnostics', [], 'diagnostics-preference-get', undefined],
  ['getHardwareAcceleration', [], 'hardware-acceleration-preference-get', undefined],
  ['githubInstall', [], 'github-install', undefined],
  ['githubAuthenticate', [], 'github-authenticate', undefined],
  ['githubCancelSetup', [], 'github-cancel-setup', undefined],
  ['getPerformanceMetrics', [], 'get-performance-metrics', undefined],
  ['systemIdleTime', [], 'system-idle-time', undefined],
  ['powerTier', [], 'power-tier', undefined],
  ['sidecarStatus', [], 'sidecar-status', undefined],
];

test('invoke methods send closed payloads and return the main-process result unchanged', async () => {
  const mainResult = { shown: false, reason: 'failed' };
  for (const [method, args, channel, payload] of invokeContract) {
    const { api, calls } = loadApi(mainResult);
    assert.equal(await api[method](...args), mainResult, method);
    assert.equal(calls.length, 1, method);
    assert.equal(calls[0].channel, channel, method);
    // The payload is built inside the preload's realm; copy it before comparing.
    const sent = calls[0].payload === undefined ? undefined : { ...calls[0].payload };
    assert.deepEqual(sent, payload, method);
  }
});

test('GitHub device codes use a removable trusted event subscription', () => {
  const received = [];
  const { api, listeners, removedListeners } = loadApi();

  const unsubscribe = api.onGithubAuthCode((payload) => received.push(payload));
  assert.equal(listeners.length, 1);
  assert.equal(listeners[0].channel, 'github-auth-code');

  listeners[0].listener({}, { code: 'ABCD-7HJK' });
  assert.deepEqual(received, [{ code: 'ABCD-7HJK' }]);

  unsubscribe();
  assert.equal(removedListeners.length, 1);
  assert.equal(removedListeners[0].channel, 'github-auth-code');
  assert.equal(removedListeners[0].listener, listeners[0].listener);
});

test('terminal subscribe transfers one MessagePort and posts input without invoke', () => {
  const { api, calls, posts, channels } = loadApi();
  const channel = api.terminalSubscribe('pty-1');
  const rendererPort = channels[0].port2;

  assert.equal(posts.length, 1);
  assert.equal(posts[0].channel, 'terminal-subscribe');
  assert.equal(posts[0].payload.id, 'pty-1');
  assert.equal(posts[0].ports[0], channels[0].port1);
  assert.equal(
    calls.some(
      (call) => call.channel === 'terminal-write' || call.channel === 'terminal-subscribe',
    ),
    false,
  );

  const received = [];
  channel.onEvent((event) => received.push(event));
  rendererPort.deliver({
    kind: 'data',
    data: 'hi',
    sequence: 1,
    byteOffset: 2,
  });
  assert.equal(received.length, 1);
  assert.equal(received[0].kind, 'data');
  assert.equal(received[0].data, 'hi');
  assert.equal(received[0].sequence, 1);
  assert.equal(received[0].byteOffset, 2);
  assert.equal(rendererPort.posted[0].type, 'ack');
  assert.equal(rendererPort.posted[0].bytes, 2);

  channel.postInput('x');
  assert.equal(rendererPort.posted[1].type, 'input');
  assert.equal(rendererPort.posted[1].data, 'x');
});

test('preload queues stay bounded before a consumer attaches and report dropped bytes', () => {
  const { api, channels } = loadApi();
  const channel = api.terminalSubscribe('pty-1');
  const rendererPort = channels[0].port2;
  const chunk = 'x'.repeat(64 * 1024);
  const flood = 40;

  for (let index = 0; index < flood; index += 1) {
    rendererPort.deliver({
      kind: 'data',
      data: chunk,
      sequence: index + 1,
      byteOffset: (index + 1) * chunk.length,
    });
  }

  const received = [];
  channel.onEvent((event) => received.push(event));
  const queuedBytes = received.reduce(
    (total, payload) => total + Buffer.byteLength(payload.data || '', 'utf8'),
    0,
  );
  assert.ok(queuedBytes <= 2 * 1024 * 1024);
  assert.ok(received.some((payload) => payload.truncated === true && payload.droppedBytes > 0));
  assert.ok(received.length < flood);
});
