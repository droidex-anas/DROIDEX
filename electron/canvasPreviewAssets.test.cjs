const assert = require('node:assert/strict');
const { createHash, createHmac } = require('node:crypto');
const { mkdtemp, mkdir, rm, writeFile } = require('node:fs/promises');
const { tmpdir } = require('node:os');
const { join } = require('node:path');
const test = require('node:test');
const { readCanvasPreviewAsset } = require('./canvasPreviewAssets.cjs');

const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/iZk9HQAAAABJRU5ErkJggg==',
  'base64',
);

test('the preview host serves an image only under its owning canvas', async (t) => {
  const profile = await mkdtemp(join(tmpdir(), 'preview-assets-'));
  t.after(() => rm(profile, { recursive: true, force: true }));
  const canvasRoot = join(profile, 'canvases');
  const fontRoot = join(profile, 'canvas-fonts');
  const secret = 'unit-preview-secret';
  const assetId = createHash('sha256').update(PNG).digest('hex');
  await mkdir(join(canvasRoot, 'canvas-b', 'assets'), { recursive: true });
  await writeFile(join(canvasRoot, 'canvas-b', 'assets', assetId), PNG);
  await mkdir(join(canvasRoot, 'canvas-a', 'assets'), { recursive: true });

  const reference = (canvasId) => {
    const sig = createHmac('sha256', secret).update(`${canvasId}\0${assetId}`).digest('hex');
    return `droidex-canvas-preview://preview/asset/${canvasId}/${assetId}?sig=${sig}`;
  };
  const options = { canvasRoot, fontRoot, secret };
  const owned = await readCanvasPreviewAsset(reference('canvas-b'), options);
  assert.equal(owned?.mime, 'image/png');
  assert.deepEqual(owned?.data, PNG);
  assert.equal(await readCanvasPreviewAsset(reference('canvas-a'), options), null);
  assert.equal(
    await readCanvasPreviewAsset(reference('canvas-b').replace('canvas-b', 'canvas-a'), options),
    null,
  );
});
