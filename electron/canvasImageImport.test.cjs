const test = require('node:test');
const assert = require('node:assert/strict');
const { mkdtemp, rm, writeFile } = require('node:fs/promises');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const {
  answerProjectImageRequest,
  createCanvasImageImporter,
  isProjectImageRequest,
} = require('./canvasImageImport.cjs');

const CANVAS = { kind: 'canvas', canvasId: 'canvas-one' };
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/iZk9HQAAAABJRU5ErkJggg==',
  'base64',
);

function importer() {
  return createCanvasImageImporter(
    {
      createFromBuffer: () => ({
        isEmpty: () => false,
        getSize: () => ({ width: 1, height: 1 }),
        toBitmap: () => Buffer.alloc(4),
      }),
    },
    { getBridgeInfo: async () => ({ port: 1234 }), canvasAssetSecret: () => 'secret' },
  );
}

test('a selected image must match its PNG extension before import', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'canvas-import-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const originalFetch = global.fetch;
  global.fetch = async () => new Response(JSON.stringify({ assetId: 'unused' }), { status: 200 });
  t.after(() => {
    global.fetch = originalFetch;
  });
  for (const name of ['image.jpg', 'image.svg']) {
    const filePath = join(directory, name);
    await writeFile(filePath, PNG);
    await assert.rejects(importer()(CANVAS, filePath), { code: 'invalid_input' });
  }
});

test('oversized PNG, JPEG and WebP headers are refused before native decoding', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'canvas-import-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const nativeImage = {
    createFromBuffer: t.mock.fn(() => {
      throw new Error('Decoded');
    }),
  };
  const canvas = require('@napi-rs/canvas');
  const webpDecode = t.mock.method(canvas, 'loadImage', async () => {
    throw new Error('Decoded');
  });
  const importImage = createCanvasImageImporter(nativeImage, {});
  const png = Buffer.from(PNG);
  png.writeUInt32BE(8193, 16);
  const jpeg = Buffer.from('ffd8ffc0000b080001200103011100ffd9', 'hex');
  const webp = (chunk, body) => {
    const header = Buffer.alloc(20);
    header.write('RIFF');
    header.writeUInt32LE(12 + body.length, 4);
    header.write('WEBP', 8);
    header.write(chunk, 12);
    header.writeUInt32LE(body.length, 16);
    return Buffer.concat([header, body]);
  };
  for (const [name, bytes] of [
    ['large.png', png],
    ['large.jpg', jpeg],
    ['large-extended.webp', webp('VP8X', Buffer.from('00000000002000000000', 'hex'))],
    ['large-lossless.webp', webp('VP8L', Buffer.from('2f0020000000', 'hex'))],
    ['large-lossy.webp', webp('VP8 ', Buffer.from('1000009d012a01200100', 'hex'))],
  ]) {
    const filePath = join(directory, name);
    await writeFile(filePath, bytes);
    await assert.rejects(importImage(CANVAS, filePath), {
      code: 'invalid_input',
      message: 'Choose an image at most 8192 pixels per side.',
    });
  }
  assert.equal(nativeImage.createFromBuffer.mock.callCount(), 0);
  assert.equal(webpDecode.mock.callCount(), 0);
});

test('a kit image goes to the kit route without a canvas', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'canvas-import-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const filePath = join(directory, 'logo.png');
  await writeFile(filePath, PNG);
  const originalFetch = global.fetch;
  const requests = [];
  global.fetch = async (url, init) => {
    requests.push({ url, body: JSON.parse(init.body) });
    return new Response(JSON.stringify({ assetId: 'kit' }), { status: 200 });
  };
  t.after(() => {
    global.fetch = originalFetch;
  });

  assert.deepEqual(await importer()({ kind: 'kit' }, filePath), { assetId: 'kit' });
  assert.equal(requests[0].url, 'http://127.0.0.1:1234/canvas/import-kit-image');
  assert.deepEqual(Object.keys(requests[0].body).sort(), ['digest', 'filePath', 'height', 'width']);
  await assert.rejects(importer()({ kind: 'canvas', canvasId: '../x' }, filePath), {
    code: 'invalid_input',
  });
});

test('an SVG goes to the sidecar as markup, without dimensions and without decoding', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'canvas-import-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const filePath = join(directory, 'logo.svg');
  await writeFile(filePath, '<?xml version="1.0"?><svg xmlns="http://www.w3.org/2000/svg"/>');
  const originalFetch = global.fetch;
  const bodies = [];
  global.fetch = async (_url, init) => {
    bodies.push(JSON.parse(init.body));
    return new Response(JSON.stringify({ assetId: 'svg' }), { status: 200 });
  };
  t.after(() => {
    global.fetch = originalFetch;
  });
  const nativeImage = { createFromBuffer: t.mock.fn() };
  const importImage = createCanvasImageImporter(nativeImage, {
    getBridgeInfo: async () => ({ port: 1234 }),
    canvasAssetSecret: () => 'secret',
  });

  assert.deepEqual(await importImage(CANVAS, filePath), { assetId: 'svg' });
  assert.deepEqual(Object.keys(bodies[0]).sort(), ['canvasId', 'digest', 'filePath']);
  assert.equal(nativeImage.createFromBuffer.mock.callCount(), 0);
});

test('a missing selection returns a curated error without its private path', async () => {
  const filePath = join(tmpdir(), 'canvas-missing-private.png');
  await assert.rejects(importer()(CANVAS, filePath), (error) => {
    assert.equal(error.code, 'invalid_input');
    assert.equal(error.message.includes(filePath), false);
    return true;
  });
});

test('a sidecar storage failure keeps its curated code', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'canvas-import-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const filePath = join(directory, 'image.png');
  await writeFile(filePath, PNG);
  const originalFetch = global.fetch;
  global.fetch = async () =>
    new Response(
      JSON.stringify({ code: 'storage_failed', message: 'Free disk space and retry.' }),
      {
        status: 400,
      },
    );
  t.after(() => {
    global.fetch = originalFetch;
  });
  await assert.rejects(importer()(CANVAS, filePath), {
    code: 'storage_failed',
    message: 'Free disk space and retry.',
  });
});

test('the sidecar’s request for a project image is answered under its id', async () => {
  const request = {
    type: 'canvas.importImage',
    id: 'request-1',
    canvasId: 'canvas-one',
    filePath: '/project/logo.png',
  };
  assert.equal(isProjectImageRequest(request), true);
  assert.equal(isProjectImageRequest({ type: 'browser.request', id: 'request-1' }), false);
  const replies = [];
  const reply = (message) => replies.push(message);
  await answerProjectImageRequest(async (owner, filePath) => ({ owner, filePath }), request, reply);
  await answerProjectImageRequest(
    async () => {
      throw new Error('EACCES /project/logo.png');
    },
    { ...request, id: 'request-2' },
    reply,
  );
  assert.deepEqual(replies, [
    {
      type: 'canvas.importImageResult',
      id: 'request-1',
      result: { ok: true, asset: { owner: CANVAS, filePath: '/project/logo.png' } },
    },
    {
      type: 'canvas.importImageResult',
      id: 'request-2',
      result: {
        ok: false,
        error: {
          code: 'storage_failed',
          message: 'The image could not be saved. Reopen DROIDEX and try again.',
        },
      },
    },
  ]);
});
