import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeUrl, pageLayout, viewportForMode, viewportFromFrame } from './browserViewport';

test('viewportFromFrame fills the pane edge to edge', () => {
  assert.deepEqual(viewportFromFrame({ width: 1325, height: 857 }), {
    width: 1325,
    height: 857,
    deviceScaleFactor: 2,
  });
});

test('a standard size keeps its own size and is drawn scaled down to fit the pane', () => {
  const fit = { width: 1000, height: 600, deviceScaleFactor: 2 };
  const desktop = viewportForMode('desktop', fit);
  assert.deepEqual(desktop, { width: 1440, height: 900, deviceScaleFactor: 2 });
  assert.deepEqual(pageLayout({ width: 756, height: 1000 }, desktop, 'desktop'), {
    width: 720,
    height: 450,
    left: 18,
    top: 275,
    scale: 0.5,
  });
  assert.equal(pageLayout({ width: 1600, height: 1000 }, desktop, 'desktop').scale, 1);
  assert.equal(pageLayout({ width: 756, height: 1000 }, fit, 'fit').scale, undefined);
});

test('normalizeUrl preserves local browser targets', () => {
  assert.equal(normalizeUrl('127.0.0.1:1420'), 'http://127.0.0.1:1420');
  assert.equal(normalizeUrl('localhost:3000/app'), 'http://localhost:3000/app');
  assert.equal(normalizeUrl('//example.com/path'), 'https://example.com/path');
  assert.equal(normalizeUrl('::1:8080/dev'), 'http://[::1]:8080/dev');
  assert.equal(normalizeUrl('example.com'), 'https://example.com');
  assert.equal(normalizeUrl('about:blank'), 'about:blank');
});

test('normalizeUrl opens sites and searches for everything else', () => {
  assert.equal(normalizeUrl('docs.foo.dev/path'), 'https://docs.foo.dev/path');
  assert.equal(normalizeUrl('192.168.1.5:3000'), 'https://192.168.1.5:3000');
  assert.equal(normalizeUrl('devbox:8080/app'), 'https://devbox:8080/app');
  assert.equal(normalizeUrl('google'), 'https://www.google.com/search?q=google');
  assert.equal(normalizeUrl('hey there'), 'https://www.google.com/search?q=hey%20there');
  // A login or spaces in the path keep an address an address, never a search.
  assert.equal(
    normalizeUrl('alice:secret@localhost:3000/private'),
    'http://alice:secret@localhost:3000/private',
  );
  assert.equal(normalizeUrl('example.com/my page'), 'https://example.com/my page');
  assert.equal(
    normalizeUrl('what is 1.5 + 2'),
    'https://www.google.com/search?q=what%20is%201.5%20%2B%202',
  );
});
