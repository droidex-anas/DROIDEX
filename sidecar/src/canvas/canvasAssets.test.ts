import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, promises as fs } from 'node:fs';
import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  truncate,
  unlink,
  writeFile,
} from 'node:fs/promises';
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
  const scopes = new CanvasScopes();
  const workspace = await CanvasWorkspace.open(root, quietBuilds(), {
    isChatKnown: (appSessionId) => appSessionId === 'image-chat',
    isScopeActive: (scopeId) => scopes.isScopeActive(scopeId),
    bindScopeCanvas: (scopeId, canvasId) => scopes.bindScopeCanvas(scopeId, canvasId),
  });
  t.after(() => workspace.close());
  const { canvasId } = await workspace.createCanvas('image-chat', 'create-image-canvas');
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

test('an import its requester stopped wanting while it was read is never saved', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'canvas-assets-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const scopes = new CanvasScopes();
  const workspace = await CanvasWorkspace.open(root, quietBuilds(), {
    isChatKnown: (appSessionId) => appSessionId === 'image-chat',
    isScopeActive: (scopeId) => scopes.isScopeActive(scopeId),
    bindScopeCanvas: (scopeId, canvasId) => scopes.bindScopeCanvas(scopeId, canvasId),
  });
  t.after(() => workspace.close());
  const { canvasId } = await workspace.createCanvas('image-chat', 'create-image-canvas');
  const filePath = join(root, 'chosen.png');
  await writeFile(filePath, CANVAS_PNG);
  const request = { canvasId, filePath, digest: CANVAS_PNG_ASSET_ID, width: 1, height: 1 };

  let asked = 0;
  const stoppedWanting = () => {
    asked += 1;
    return false;
  };
  await assert.rejects(workspace.importCanvasImage(request, stoppedWanting), {
    code: 'scope_expired',
  });
  assert.equal(asked, 1);
  assert.deepEqual(await listCanvasAssets(root, canvasId), []);

  let wantedChecks = 0;
  const stoppedWantingWhileSaving = () => {
    wantedChecks += 1;
    return wantedChecks === 1;
  };
  await assert.rejects(workspace.importCanvasImage(request, stoppedWantingWhileSaving), {
    code: 'scope_expired',
  });
  assert.equal(wantedChecks, 2);
  assert.deepEqual(await listCanvasAssets(root, canvasId), []);
});

test('an SVG import keeps sanitised vectors under the hash of what it keeps', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'canvas-svg-assets-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const canvasId = 'canvas-1';
  await mkdir(join(root, canvasId));
  const filePath = join(root, 'logo.svg');
  const markup = Buffer.from(
    '<svg xmlns="http://www.w3.org/2000/svg" width="64" height="32" onload="alert(1)"><script>alert(1)</script><path d="M0 0h64v32z"/></svg>',
  );
  await writeFile(filePath, markup);
  const digest = createHash('sha256').update(markup).digest('hex');

  const asset = await importCanvasImage(root, { canvasId, filePath, digest });
  const kept = await readFile(join(root, canvasId, 'assets', asset.assetId));
  assert.equal(
    kept.toString(),
    '<svg xmlns="http://www.w3.org/2000/svg" width="64" height="32"><path d="M0 0h64v32z"/></svg>',
  );
  assert.deepEqual(asset, {
    assetId: createHash('sha256').update(kept).digest('hex'),
    mediaType: 'image/svg+xml',
    byteLength: kept.length,
    width: 64,
    height: 32,
  });
  assert.deepEqual(await listCanvasAssets(root, canvasId), [asset]);

  // A raster file cannot pass as markup, and markup cannot pass as a decoded raster.
  await writeFile(filePath, CANVAS_PNG);
  await assert.rejects(
    importCanvasImage(root, { canvasId, filePath, digest: CANVAS_PNG_ASSET_ID }),
    { code: 'invalid_input' },
  );
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
