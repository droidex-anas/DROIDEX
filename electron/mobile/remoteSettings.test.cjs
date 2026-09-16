const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { pairingQrDataUrl } = require('./qr.cjs');
const { isRemoteSettingsSender } = require('./settingsSender.cjs');

function sender(url, subframe = false) {
  const mainFrame = {};
  return { sender: { mainFrame, getURL: () => url }, senderFrame: subframe ? {} : mainFrame };
}

test('remote IPC is limited to the main renderer, not iframes or unrelated pages', () => {
  const root = path.resolve('/test/app');
  const app = pathToFileURL(path.join(root, 'dist', 'index.html')).href;
  assert.equal(isRemoteSettingsSender(sender(app), root), true);
  assert.equal(isRemoteSettingsSender(sender(app, true), root), false);
  assert.equal(isRemoteSettingsSender(sender('https://example.com/'), root), false);
  assert.equal(isRemoteSettingsSender(sender(pathToFileURL(path.join(root, 'other.html')).href), root), false);
  assert.equal(isRemoteSettingsSender(sender('http://localhost:5173/'), root, 'http://localhost:5173/'), true);
  assert.equal(isRemoteSettingsSender(sender('http://localhost:5174/'), root, 'http://localhost:5173/'), false);
  assert.equal(isRemoteSettingsSender(sender('http://localhost:5173/foreign'), root, 'http://localhost:5173/'), false);
  assert.equal(isRemoteSettingsSender(sender('not-a-url'), root), false);
});

test('pairing QR stays local, deterministic, high contrast, and has a four-module quiet zone', () => {
  const code = 'DX1.' + Buffer.from(JSON.stringify({ version: 1, address: 'https://192.168.1.2:43210', fingerprint: 'a'.repeat(64), ticket: 'b'.repeat(64) })).toString('base64url');
  const image = pairingQrDataUrl(code);
  assert.equal(image, pairingQrDataUrl(code));
  assert.match(image, /^data:image\/svg\+xml;base64,/);
  const svg = Buffer.from(image.split(',')[1], 'base64').toString();
  assert.match(svg, /fill="white"/);
  assert.match(svg, /fill="black"/);
  const width = Number(svg.match(/viewBox="0 0 (\d+)/)[1]);
  const modules = [...svg.matchAll(/M(\d+),(\d+)h1v1h-1z/g)];
  assert.ok(modules.length > 500);
  for (const [, x, y] of modules) {
    assert.ok(Number(x) >= 4 && Number(y) >= 4);
    assert.ok(Number(x) < width - 4 && Number(y) < width - 4);
  }
  assert.doesNotMatch(svg, /<script|<image|href=/);
  for (const invalid of ['', '<script>', 'https://example.com', 'DX1.' + 'a'.repeat(2048)]) {
    assert.throws(() => pairingQrDataUrl(invalid), /Invalid/);
  }
});
