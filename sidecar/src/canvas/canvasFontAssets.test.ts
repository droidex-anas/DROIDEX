import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { hostKitFonts } from './canvasFontAssets.js';

test('kit fonts become one host asset each instead of artifact data URLs', async (t) => {
  const profile = await mkdtemp(join(tmpdir(), 'canvas-fonts-'));
  const previous = process.env.DROIDEX_USER_DATA_DIR;
  process.env.DROIDEX_USER_DATA_DIR = profile;
  t.after(async () => {
    if (previous === undefined) delete process.env.DROIDEX_USER_DATA_DIR;
    else process.env.DROIDEX_USER_DATA_DIR = previous;
    await rm(profile, { recursive: true, force: true });
  });
  const fontDirectory = join(import.meta.dirname, 'presets', 'fonts');
  const inter = JSON.parse(await readFile(join(fontDirectory, 'inter.json'), 'utf8')) as {
    css: string;
  };
  const lora = JSON.parse(await readFile(join(fontDirectory, 'lora.json'), 'utf8')) as {
    css: string;
  };
  const source = inter.css + lora.css;
  const hosted = await hostKitFonts(source);
  assert.equal(hosted.includes('data:font/woff2;base64,'), false);
  assert.equal((hosted.match(/droidex-canvas-preview:\/\/preview\/font\//g) ?? []).length, 2);
  assert.ok(Buffer.byteLength(source) - Buffer.byteLength(hosted) > 100_000);
  assert.equal((await readdir(join(profile, 'canvas-fonts'))).length, 2);
  assert.equal(await hostKitFonts(source), hosted);
  assert.equal((await readdir(join(profile, 'canvas-fonts'))).length, 2);
});
