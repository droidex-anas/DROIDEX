import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, readdir, rm, truncate, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { quietBuilds } from '../testing/canvasStorageSupport.js';
import { CanvasWorkspace } from './CanvasWorkspace.js';
import { canvasImageImportSchema, importCanvasImage, listCanvasAssets } from './canvasAssets.js';
import { CanvasScopes } from './canvasScopes.js';

const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/iZk9HQAAAABJRU5ErkJggg==',
  'base64',
);

test('main-attested image imports reject invalid inputs and dedupe owned bytes', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'canvas-assets-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const workspace = await CanvasWorkspace.open(root, quietBuilds(), new CanvasScopes());
  t.after(() => workspace.close());
  const { canvasId } = await workspace.createCanvas('image-chat');
  const filePath = join(root, 'chosen.png');
  await writeFile(filePath, PNG);
  const request = {
    canvasId,
    filePath,
    digest: createHash('sha256').update(PNG).digest('hex'),
    width: 1,
    height: 1,
  };

  const first = await importCanvasImage(root, request);
  assert.deepEqual(first, {
    assetId: request.digest,
    mediaType: 'image/png',
    byteLength: PNG.length,
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
  await writeFile(filePath, PNG);

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
  await writeFile(oversized, PNG);
  await truncate(oversized, 10 * 1024 * 1024 + 1);
  await assert.rejects(importCanvasImage(root, { ...request, filePath: oversized }), {
    code: 'invalid_input',
  });
  assert.equal(canvasImageImportSchema.safeParse({ ...request, width: 8193 }).success, false);
  assert.equal(canvasImageImportSchema.safeParse({ ...request, height: 0 }).success, false);
});
