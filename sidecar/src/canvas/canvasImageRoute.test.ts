import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import test from 'node:test';
import { serveCanvasImages, type CanvasImages } from './canvasImageRoute.js';

const images: CanvasImages = {
  secret: 'main-only-secret',
  importImage: () => Promise.reject(new Error('not this route')),
  importKitImage: () => Promise.reject(new Error('not this route')),
};

test('a design SVG comes back from the sanitise route only rebuilt, and only for main', async (t) => {
  const server = createServer((req, res) => {
    if (!serveCanvasImages(req, res, images)) res.writeHead(404).end();
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => server.close());
  const { port } = server.address() as AddressInfo;
  const sanitise = (svg: string, secret = images.secret) =>
    fetch(`http://127.0.0.1:${String(port)}/canvas/sanitise-svg`, {
      method: 'POST',
      headers: { 'content-type': 'image/svg+xml', 'x-canvas-secret': secret },
      body: svg,
    });

  const markup = '<svg width="10" height="10"><script>alert(1)</script><rect width="10" /></svg>';
  assert.equal((await sanitise(markup, 'renderer-token')).status, 401);
  const rebuilt = await sanitise(markup);
  assert.equal(rebuilt.status, 200);
  assert.equal(
    await rebuilt.text(),
    '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><rect width="10"/></svg>',
  );
  assert.equal((await sanitise('<div>not svg</div>')).status, 400);
  assert.equal((await sanitise(`<svg>${'x'.repeat(256 * 1024)}</svg>`)).status, 400);
});
