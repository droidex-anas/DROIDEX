const test = require('node:test');
const assert = require('node:assert/strict');
const { lstat, mkdir, mkdtemp, rename, rm, symlink, writeFile } = require('node:fs/promises');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const {
  createCanvasImageImporter,
  createProjectImageRequests,
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

test('a project image whose folder was swapped for a link after the sidecar checked it is refused', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'canvas-import-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  await mkdir(join(directory, 'project/assets'), { recursive: true });
  await mkdir(join(directory, 'outside'));
  const filePath = join(directory, 'project/assets/logo.png');
  await writeFile(filePath, PNG);
  await writeFile(join(directory, 'outside/logo.png'), PNG);
  const { dev, ino, size } = await lstat(filePath);
  await rename(join(directory, 'project/assets'), join(directory, 'project/moved'));
  await symlink(join(directory, 'outside'), join(directory, 'project/assets'));
  const originalFetch = global.fetch;
  const fetched = [];
  global.fetch = async (url) => {
    fetched.push(url);
    return new Response(JSON.stringify({ assetId: 'outside' }), { status: 200 });
  };
  t.after(() => {
    global.fetch = originalFetch;
  });

  const project = {
    requestId: 'request-1',
    file: { dev, ino, size },
    bridge: { port: 1234, secret: 'secret' },
    signal: new AbortController().signal,
    runEnded: () => false,
  };
  await assert.rejects(importer()(CANVAS, filePath, project), {
    code: 'invalid_input',
    message: 'The image changed while it was being imported. Try again.',
  });
  assert.deepEqual(fetched, []);
});

/** The sidecar's side of main's project image requests: each reply lands when it is sent. */
function sidecarRun(handle) {
  const replies = [];
  let replied = Promise.withResolvers();
  let ended = false;
  const send = (message) =>
    handle(
      message,
      (answer) => {
        replies.push(answer);
        replied.resolve();
        replied = Promise.withResolvers();
      },
      () => ended,
    );
  return {
    replies,
    send,
    nextReply: () => replied.promise,
    end: () => {
      ended = true;
    },
  };
}

async function projectImage(t) {
  const directory = await mkdtemp(join(tmpdir(), 'canvas-import-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const filePath = join(directory, 'logo.png');
  await writeFile(filePath, PNG);
  const { dev, ino, size } = await lstat(filePath);
  return {
    type: 'canvas.importImage',
    id: 'request-1',
    canvasId: 'canvas-one',
    filePath,
    file: { dev, ino, size },
  };
}

test('a project import stops before it posts once its sidecar is replaced or cancels it', async (t) => {
  const request = await projectImage(t);
  const originalFetch = global.fetch;
  const fetched = [];
  global.fetch = async (url) => {
    fetched.push(url);
    return new Response(JSON.stringify({ assetId: 'unused' }), { status: 200 });
  };
  t.after(() => {
    global.fetch = originalFetch;
  });
  let port = 1111;
  let duringDecode = () => undefined;
  const importImage = createCanvasImageImporter(
    {
      createFromBuffer: () => {
        duringDecode();
        return {
          isEmpty: () => false,
          getSize: () => ({ width: 1, height: 1 }),
          toBitmap: () => Buffer.alloc(4),
        };
      },
    },
    { getBridgeInfo: async () => ({ port }), canvasAssetSecret: () => 'secret' },
  );
  const handle = createProjectImageRequests(importImage, {
    getBridgeInfo: async () => ({ port }),
    canvasAssetSecret: () => 'secret',
  });

  const replaced = sidecarRun(handle);
  duringDecode = () => {
    replaced.end();
    port = 2222;
  };
  assert.equal(replaced.send(request), true);
  await replaced.nextReply();

  const cancelling = sidecarRun(handle);
  duringDecode = () => cancelling.send({ type: 'canvas.importImageCancel', id: 'request-2' });
  assert.equal(cancelling.send({ ...request, id: 'request-2' }), true);
  await cancelling.nextReply();

  assert.deepEqual(fetched, []);
  assert.equal(replaced.replies[0].result.ok, false);
  assert.equal(cancelling.replies[0].result.ok, false);
});

test('the sidecar’s request for a project image is answered under its id', async (t) => {
  const request = await projectImage(t);
  const posted = [];
  const originalFetch = global.fetch;
  global.fetch = async (url, init) => {
    posted.push({ url, body: JSON.parse(init.body) });
    return new Response(JSON.stringify({ assetId: 'logo' }), { status: 200 });
  };
  t.after(() => {
    global.fetch = originalFetch;
  });
  const handle = createProjectImageRequests(importer(), {
    getBridgeInfo: async () => ({ port: 1234 }),
    canvasAssetSecret: () => 'secret',
  });
  const run = sidecarRun(handle);
  assert.equal(run.send({ type: 'browser.request', id: 'request-1' }), false);

  assert.equal(run.send(request), true);
  await run.nextReply();
  assert.equal(run.send({ ...request, id: 'request-2', file: { ...request.file, ino: 0 } }), true);
  await run.nextReply();

  assert.equal(posted.length, 1);
  assert.equal(posted[0].url, 'http://127.0.0.1:1234/canvas/import-image');
  assert.equal(posted[0].body.requestId, 'request-1');
  assert.deepEqual(run.replies, [
    {
      type: 'canvas.importImageResult',
      id: 'request-1',
      result: { ok: true, asset: { assetId: 'logo' } },
    },
    {
      type: 'canvas.importImageResult',
      id: 'request-2',
      result: {
        ok: false,
        error: {
          code: 'invalid_input',
          message: 'The image changed while it was being imported. Try again.',
        },
      },
    },
  ]);
});
