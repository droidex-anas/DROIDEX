const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { installRendererNavigationGuard, isTrustedRendererUrl } = require('./rendererSecurity.cjs');

test('renderer navigation stays on the exact packaged app file or the configured dev origin', () => {
  const packaged = 'file:///Applications/DROIDEX.app/Contents/Resources/app.asar/dist/index.html';
  assert.equal(isTrustedRendererUrl(`${packaged}#/settings`, packaged), true);
  assert.equal(isTrustedRendererUrl('file:///etc/passwd', packaged), false);
  assert.equal(isTrustedRendererUrl('https://attacker.example/', packaged), false);

  const dev = 'http://127.0.0.1:1420/';
  assert.equal(isTrustedRendererUrl('http://127.0.0.1:1420/settings', dev), true);
  assert.equal(isTrustedRendererUrl('http://localhost:1420/', dev), false);
});

test('navigation guard blocks foreign navigation and opens web popups externally', () => {
  const contents = new EventEmitter();
  let windowHandler;
  contents.setWindowOpenHandler = (handler) => {
    windowHandler = handler;
  };
  const opened = [];
  installRendererNavigationGuard(contents, 'http://127.0.0.1:1420/', (url) => opened.push(url));
  let prevented = false;
  contents.emit(
    'will-navigate',
    { preventDefault: () => (prevented = true) },
    'https://attacker.example/',
  );

  assert.equal(prevented, true);
  assert.deepEqual(windowHandler({ url: 'https://docs.example/' }), { action: 'deny' });
  assert.deepEqual(opened, ['https://docs.example/']);
  assert.deepEqual(windowHandler({ url: 'javascript:alert(1)' }), { action: 'deny' });
  assert.deepEqual(opened, ['https://docs.example/']);
});
