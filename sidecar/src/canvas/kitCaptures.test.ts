import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { errorOf, harness, okReply } from '../testing/canvasBridgeSupport.js';
import { CANVAS_PNG, pinScratchProfile } from '../testing/canvasStorageSupport.js';
import { SAMPLE_CATALOG_KIT } from '../testing/sampleKit.js';
import { saveDesignSystem } from './designSystems.js';
import type { DesignSystemRef, KitCaptureItem } from './protocol.js';

pinScratchProfile();

test("a kit keeps each preview's capture per mode, and refuses one it does not have", async (t) => {
  const canvas = await harness(t);
  const light: DesignSystemRef = await saveDesignSystem(SAMPLE_CATALOG_KIT, {
    mutationId: 'sample',
    baseVersion: null,
    savedBy: { actor: 'user' },
  });
  const dark: DesignSystemRef = { ...light, mode: 'dark' };
  const png = CANVAS_PNG.toString('base64');
  const readCapture = async (requestId: string, ref = light, item: KitCaptureItem = 'cover') => {
    await canvas.handle({ type: 'canvas.readKitCapture', requestId, ref, item });
    return okReply(canvas, requestId);
  };
  const save = (requestId: string, item: KitCaptureItem, data = png) =>
    canvas.handle({ type: 'canvas.saveKitCapture', requestId, ref: light, item, png: data });

  assert.deepEqual(await readCapture('req-none'), { kind: 'kitCapture', png: null });
  await save('req-not-png', 'cover', Buffer.from('not a picture').toString('base64'));
  assert.equal(errorOf(canvas, 'req-not-png').code, 'invalid_input');
  await save('req-unknown', 'no-such-preview');
  assert.equal(errorOf(canvas, 'req-unknown').code, 'invalid_input');

  await save('req-cover', 'cover');
  assert.deepEqual(okReply(canvas, 'req-cover'), { kind: 'ok' });
  await save('req-card', 'pricing');
  assert.deepEqual(okReply(canvas, 'req-card'), { kind: 'ok' });

  assert.deepEqual(await readCapture('req-saved'), { kind: 'kitCapture', png });
  assert.deepEqual(await readCapture('req-card-saved', light, 'pricing'), {
    kind: 'kitCapture',
    png,
  });
  assert.deepEqual(await readCapture('req-dark', dark), { kind: 'kitCapture', png: null });

  await save('req-no-entry', { entry: 'No such entry' });
  assert.equal(errorOf(canvas, 'req-no-entry').code, 'invalid_input');
  await save('req-entry', { entry: 'Button' });
  assert.deepEqual(okReply(canvas, 'req-entry'), { kind: 'ok' });
  assert.deepEqual(await readCapture('req-entry-saved', light, { entry: 'Button' }), {
    kind: 'kitCapture',
    png,
  });
  assert.deepEqual(await readCapture('req-entry-dark', dark, { entry: 'Button' }), {
    kind: 'kitCapture',
    png: null,
  });
});

test('the DROIDEX preset shows the captures it ships over one taken here', async (t) => {
  const canvas = await harness(t);
  const light: DesignSystemRef = { id: 'droidex', version: 1, mode: 'light' };
  const png = CANVAS_PNG.toString('base64');
  const readCapture = async (requestId: string, item: string) => {
    await canvas.handle({ type: 'canvas.readKitCapture', requestId, ref: light, item });
    return okReply(canvas, requestId);
  };
  const save = (requestId: string, item: string) =>
    canvas.handle({ type: 'canvas.saveKitCapture', requestId, ref: light, item, png });
  const shipped = async (file: string) => ({
    kind: 'kitCapture',
    png: (await readFile(new URL(`./presets/droidex/${file}`, import.meta.url))).toString('base64'),
  });

  await save('req-cover', 'cover');
  assert.deepEqual(okReply(canvas, 'req-cover'), { kind: 'ok' });
  assert.deepEqual(await readCapture('req-cover-read', 'cover'), await shipped('cover-light.png'));
  assert.deepEqual(
    await readCapture('req-sidebar', 'sidebar'),
    await shipped('previews/sidebar-light.png'),
  );
});
