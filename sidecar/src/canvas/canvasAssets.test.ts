import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, promises as fs } from 'node:fs';
import { mkdir, mkdtemp, readdir, rm, truncate, unlink, writeFile } from 'node:fs/promises';
import { syncBuiltinESMExports } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { CANVAS_PNG, CANVAS_PNG_ASSET_ID, quietBuilds } from '../testing/canvasStorageSupport.js';
import { CanvasWorkspace } from './CanvasWorkspace.js';
import { canvasImageImportSchema, importCanvasImage, listCanvasAssets } from './canvasAssets.js';
import { CanvasScopes } from './canvasScopes.js';

test('main-attested image imports reject invalid inputs and dedupe owned bytes', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'canvas-assets-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const workspace = await CanvasWorkspace.open(root, quietBuilds(), new CanvasScopes());
  t.after(() => workspace.close());
  const { canvasId } = await workspace.createCanvas('image-chat');
  const filePath = join(root, 'chosen.png');
  await writeFile(filePath, CANVAS_PNG);
  const request = {
    canvasId,
    filePath,
    digest: CANVAS_PNG_ASSET_ID,
    width: 1,
    height: 1,
  };

  const first = await importCanvasImage(root, request);
  assert.deepEqual(first, {
    assetId: request.digest,
    mediaType: 'image/png',
    byteLength: CANVAS_PNG.length,
    width: 1,
    height: 1,
  });
  assert.deepEqual(await importCanvasImage(root, request), first);
  await unlink(filePath);
  assert.deepEqual(await listCanvasAssets(root, canvasId), [first]);
  assert.deepEqual(await readdir(join(root, canvasId, 'assets')), [
    first.assetId,
    `${first.assetId}.json`,
  ]);
  await writeFile(filePath, CANVAS_PNG);

  await assert.rejects(importCanvasImage(root, { ...request, filePath: 'relative.png' }), {
    code: 'invalid_input',
  });
  await assert.rejects(importCanvasImage(root, { ...request, digest: 'f'.repeat(64) }), {
    code: 'invalid_input',
  });
  const svg = join(root, 'script.svg');
  const svgBytes = Buffer.from('<svg onload="alert(1)"/>');
  await writeFile(svg, svgBytes);
  await assert.rejects(
    importCanvasImage(root, {
      ...request,
      filePath: svg,
      digest: createHash('sha256').update(svgBytes).digest('hex'),
    }),
    { code: 'invalid_input' },
  );
  const oversized = join(root, 'large.png');
  await writeFile(oversized, CANVAS_PNG);
  await truncate(oversized, 10 * 1024 * 1024 + 1);
  await assert.rejects(importCanvasImage(root, { ...request, filePath: oversized }), {
    code: 'invalid_input',
  });
  assert.equal(canvasImageImportSchema.safeParse({ ...request, width: 8193 }).success, false);
  assert.equal(canvasImageImportSchema.safeParse({ ...request, height: 0 }).success, false);
});

for (const boundary of [
  { name: 'metadata directory', directory: 'assets' },
  { name: 'canvas directory', directory: '' },
]) {
  test(
    `image import retries the failed ${boundary.name} flush before acknowledging`,
    {
      skip: process.platform === 'win32',
    },
    async (t) => {
      const root = await mkdtemp(join(tmpdir(), 'canvas-assets-retry-'));
      t.after(() => rm(root, { recursive: true, force: true }));
      const canvasId = 'canvas-1';
      const canvas = join(root, canvasId);
      await mkdir(canvas);
      const filePath = join(root, 'chosen.png');
      await writeFile(filePath, CANVAS_PNG);
      const request = {
        canvasId,
        filePath,
        digest: CANVAS_PNG_ASSET_ID,
        width: 1,
        height: 1,
      };
      const metadata = join(canvas, 'assets', `${request.digest}.json`);
      const realOpen = fs.open;
      let failFlush = true;
      const fault = t.mock.method(fs, 'open', async (...args: Parameters<typeof fs.open>) => {
        const handle = await realOpen(...args);
        if (args[0] !== join(canvas, boundary.directory)) return handle;
        return new Proxy(handle, {
          get(target, property) {
            if (property === 'sync') {
              return async () => {
                if (failFlush && existsSync(metadata))
                  throw new Error('Injected directory flush failure');
                await target.sync();
              };
            }
            const value = Reflect.get(target, property, target);
            return typeof value === 'function' ? value.bind(target) : value;
          },
        });
      });
      syncBuiltinESMExports();
      try {
        await assert.rejects(importCanvasImage(root, request), { code: 'storage_failed' });
        await assert.rejects(importCanvasImage(root, request), { code: 'storage_failed' });
        failFlush = false;
        const receipt = await importCanvasImage(root, request);
        assert.equal(receipt.assetId, request.digest);
        assert.deepEqual(await importCanvasImage(root, request), receipt);
        assert.deepEqual(await listCanvasAssets(root, canvasId), [receipt]);
        assert.deepEqual((await readdir(join(canvas, 'assets'))).sort(), [
          request.digest,
          `${request.digest}.json`,
        ]);
      } finally {
        fault.mock.restore();
        syncBuiltinESMExports();
      }
    },
  );
}
