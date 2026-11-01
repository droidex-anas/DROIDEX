import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, readdir, rm, truncate, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test, type TestContext } from 'node:test';
import { compileInput } from '../testing/canvasCompilerSupport.js';
import {
  CANVAS_PNG,
  CANVAS_PNG_ASSET_ID,
  pinScratchProfile,
} from '../testing/canvasStorageSupport.js';
import { CompilerWorker } from './compiler.js';
import { readDesignSystem, saveDesignSystem, type DesignSystem } from './designSystems.js';
import { systemsRoot } from './designSystemStorage.js';
import { importKitImage, kitImageImportSchema } from './kitAssets.js';
import { readKitCapture, saveKitCapture } from './kitCaptures.js';
import { DROIDEX_DESIGN_SYSTEM } from './presets/droidex.js';

pinScratchProfile();

async function chosenImage(t: TestContext, bytes: Buffer = CANVAS_PNG) {
  const folder = await mkdtemp(join(tmpdir(), 'kit-image-'));
  t.after(() => rm(folder, { recursive: true, force: true }));
  const filePath = join(folder, 'chosen.png');
  await writeFile(filePath, bytes);
  const digest = createHash('sha256').update(bytes).digest('hex');
  return { filePath, digest, width: 1, height: 1 };
}

test('kit image imports apply the canvas image checks and keep one copy', async (t) => {
  const request = await chosenImage(t);

  const first = await importKitImage(request);
  assert.deepEqual(first, {
    assetId: CANVAS_PNG_ASSET_ID,
    mediaType: 'image/png',
    byteLength: CANVAS_PNG.length,
    width: 1,
    height: 1,
  });
  assert.deepEqual(await importKitImage(request), first);
  assert.deepEqual((await readdir(join(systemsRoot(), 'assets'))).sort(), [
    first.assetId,
    `${first.assetId}.json`,
  ]);
  assert.deepEqual(await readFile(join(systemsRoot(), 'assets', first.assetId)), CANVAS_PNG);

  await assert.rejects(importKitImage({ ...request, filePath: 'relative.png' }), {
    code: 'invalid_input',
  });
  await assert.rejects(importKitImage({ ...request, digest: 'f'.repeat(64) }), {
    code: 'invalid_input',
  });
  const svg = await chosenImage(t, Buffer.from('<svg onload="alert(1)"/>'));
  await assert.rejects(importKitImage(svg), { code: 'invalid_input' });
  const oversized = await chosenImage(t);
  await truncate(oversized.filePath, 10 * 1024 * 1024 + 1);
  await assert.rejects(importKitImage(oversized), { code: 'invalid_input' });
  assert.equal(kitImageImportSchema.safeParse({ ...request, canvasId: 'canvas-1' }).success, false);
});

test('a kit document names only images that were imported', async (t) => {
  const assetId = createHash('sha256').update('not imported').digest('hex');
  const kit = (cover: DesignSystem['cover'], logo: string): Omit<DesignSystem, 'version'> => ({
    ...structuredClone(DROIDEX_DESIGN_SYSTEM),
    id: 'kit-with-images',
    cover,
    sections: [
      ...DROIDEX_DESIGN_SYSTEM.sections,
      {
        kind: 'assets',
        id: 'brand',
        title: 'Brand',
        items: [{ kind: 'asset', id: 'logo', name: 'Logo', assetId: logo }],
      },
    ],
  });
  const options = (mutationId: string) => ({
    mutationId,
    baseVersion: null,
    savedBy: { actor: 'user' as const },
  });

  const unimported = { code: 'invalid_input', message: /Import it first/ };
  await assert.rejects(
    saveDesignSystem(kit({ kind: 'image', assetId }, CANVAS_PNG_ASSET_ID), options('cover')),
    unimported,
  );
  await assert.rejects(saveDesignSystem(kit(null, assetId), options('asset')), unimported);

  await importKitImage(await chosenImage(t));
  const cover = { kind: 'image' as const, assetId: CANVAS_PNG_ASSET_ID };
  const ref = await saveDesignSystem(kit(cover, CANVAS_PNG_ASSET_ID), options('imported'));
  assert.deepEqual((await readDesignSystem(ref)).cover, cover);
  // An image cover has no example; its capture is what picker rows and the chip show.
  await saveKitCapture({ ...ref, mode: 'dark' }, 'cover', CANVAS_PNG);
  assert.deepEqual(await readKitCapture({ ...ref, mode: 'dark' }, 'cover'), CANVAS_PNG);
});

test('a compiled design loads kit images from the preview host', async (t) => {
  const worker = new CompilerWorker();
  t.after(() => worker.terminate());
  const reference = `kit-asset:${CANVAS_PNG_ASSET_ID}`;
  const design = await worker.compile(
    compileInput({
      'main.tsx': `import './styles.css';
export default function Logo() { return <img className="logo" src="${reference}" alt="Logo" />; }
`,
      'styles.css': `.logo { background-image: url("${reference}"); }\n`,
    }),
    new AbortController().signal,
  );

  const url = `droidex-canvas-preview://preview/kit-asset/${CANVAS_PNG_ASSET_ID}`;
  assert.equal(design.html.split(url).length - 1, 2, 'the element and the stylesheet use the host');
  assert.equal(design.html.includes('kit-asset:'), false);
});
