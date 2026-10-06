import assert from 'node:assert/strict';
import test from 'node:test';
import { ownedCanvasRuntimeDir, startCanvasRuntime, stopCanvasRuntime } from './canvasRuntime.js';
import { bundleDesign } from './designBundle.js';
import { DROIDEX_DESIGN_SYSTEM } from './presets/droidex.js';

const sources = {
  files: { 'main.tsx': 'export default function Hey() {\n  return null;\n}\n' },
  kitFiles: DROIDEX_DESIGN_SYSTEM.files,
};

// Everything the bundler answers about real source is covered through the
// compiler worker in compiler.test.ts. This case is here on its own because it
// ends the esbuild service this process shares.
test('a bundle that loses the esbuild service does not blame the design', async () => {
  // Only a started runtime bundles; the compiler worker does this before it
  // accepts a request.
  assert.equal(startCanvasRuntime(ownedCanvasRuntimeDir), null);

  // The first bundle warms the service, so the second one is in flight when it
  // goes away under it.
  assert.equal((await bundleDesign(sources)).ok, true);
  const building = bundleDesign(sources);
  await stopCanvasRuntime();

  // The compiler worker turns this into an unavailable compiler, which the
  // build queue reports as this attempt's own failure and never caches. A
  // `compile_failed` diagnostic here would blame source that compiles.
  await assert.rejects(building);
  assert.equal((await bundleDesign(sources)).ok, true, 'the next build gets a fresh service');
});
