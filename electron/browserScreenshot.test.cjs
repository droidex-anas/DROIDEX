const assert = require('node:assert/strict');
const test = require('node:test');
const { createBrowserScreenshot } = require('./browserScreenshot.cjs');

// A 20 x 20 page at scroll (0, 40) with one sensitive field at (4, 4, 4 x 4).
function setup() {
  const dbg = {
    async sendCommand(method) {
      if (method === 'Page.getLayoutMetrics')
        return {
          cssVisualViewport: { clientWidth: 20, clientHeight: 20, pageX: 0, pageY: 40 },
          visualViewport: { clientWidth: 20 },
          cssContentSize: { width: 20, height: 200 },
        };
      if (method === 'Page.getFrameTree')
        return { frameTree: { frame: { loaderId: 'l1', url: 'https://example.test/page' } } };
      return { data: '' };
    },
  };
  const image = (pixels, width, height) => ({
    pixels,
    getSize: () => ({ width, height }),
    toBitmap: () => Buffer.from(pixels),
    toPNG: () => pixels,
  });
  const nativeImage = {
    createFromBuffer: () => image(Buffer.alloc(20 * 20 * 4), 20, 20),
    createFromBitmap: (pixels, { width, height }) => image(pixels, width, height),
  };
  const reading = {
    withPage: (_contents, run) => run(dbg),
    sensitiveBoxes: async () => [{ x: 4, y: 4, width: 4, height: 4 }],
  };
  const contents = { getTitle: () => 'Page', getURL: () => 'https://example.test/page' };
  const screenshots = createBrowserScreenshot({ reading, nativeImage, redactUrl: (url) => url });
  return { take: (options) => screenshots.take(contents, {}, { format: 'png', ...options }) };
}

const pixelAt = (base64, x, y) => Buffer.from(base64, 'base64')[(y * 20 + x) * 4];

test('a design pick is cropped with its sensitive fields painted over', async () => {
  const shot = await setup().take({
    region: { x: 0, y: 0, width: 20, height: 20 },
    at: { url: 'https://example.test/page#top', scroll: { x: 0, y: 40 }, onPickedPage: () => true },
  });
  assert.equal(pixelAt(shot.image, 5, 5), 0x80);
  assert.equal(pixelAt(shot.image, 15, 15), 0);
});

test('a design pick made at another scroll is not cropped', async () => {
  await assert.rejects(
    setup().take({
      region: { x: 0, y: 0, width: 20, height: 20 },
      at: { url: 'https://example.test/page', scroll: { x: 0, y: 0 }, onPickedPage: () => true },
    }),
    /moved before the pick was captured/,
  );
});

test('a design pick is not cropped from a reload of its page', async () => {
  await assert.rejects(
    setup().take({
      region: { x: 0, y: 0, width: 20, height: 20 },
      at: { url: 'https://example.test/page', scroll: { x: 0, y: 40 }, onPickedPage: () => false },
    }),
    /moved before the pick was captured/,
  );
});
