const test = require('node:test');
const assert = require('node:assert/strict');
const { mkdtemp, rm, writeFile } = require('node:fs/promises');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const { createCanvasImageImporter } = require('./canvasImageImport.cjs');

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
    await assert.rejects(importer()('canvas-one', filePath), { code: 'invalid_input' });
  }
});

test('a missing selection returns a curated error without its private path', async () => {
  const filePath = join(tmpdir(), 'canvas-missing-private.png');
  await assert.rejects(importer()('canvas-one', filePath), (error) => {
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
  await assert.rejects(importer()('canvas-one', filePath), {
    code: 'storage_failed',
    message: 'Free disk space and retry.',
  });
});
