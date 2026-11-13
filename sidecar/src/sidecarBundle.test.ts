import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

import { build } from 'esbuild';

// Only the compiler worker's build defines the __filename the TypeScript
// compiler reads as it loads. Bundled into the main sidecar, the compiler
// throws at load and the sidecar exits before it starts.
test('the main sidecar bundle never loads the TypeScript compiler', async () => {
  const result = await build({
    entryPoints: [fileURLToPath(new URL('./index.ts', import.meta.url))],
    bundle: true,
    splitting: true,
    platform: 'node',
    format: 'esm',
    outdir: 'dist',
    write: false,
    metafile: true,
    logLevel: 'silent',
  });
  const compiler = Object.keys(result.metafile.inputs).filter((path) =>
    path.includes('node_modules/typescript/'),
  );
  assert.deepEqual(compiler, [], 'Only the compiler worker may import typescript.');
});
