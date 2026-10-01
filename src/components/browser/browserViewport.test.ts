import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeUrl, pageLayout, viewportForMode, viewportFromFrame } from './browserViewport';

test('viewportFromFrame matches the fit browser surface inside the canvas frame', () => {
  assert.deepEqual(viewportFromFrame({ width: 1325, height: 857 }), {
    width: 1289,
    height: 821,
    deviceScaleFactor: 2,
  });
});

test('viewportFromFrame follows the available browser surface', () => {
  assert.deepEqual(viewportFromFrame({ width: 320, height: 300 }), {
    width: 284,
    height: 264,
    deviceScaleFactor: 2,
  });
  assert.deepEqual(viewportFromFrame({ width: 5000, height: 3000 }), {
    width: 4964,
    height: 2964,
    deviceScaleFactor: 2,
  });
  assert.deepEqual(viewportFromFrame({ width: 1325, height: 857 }, true), {
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
