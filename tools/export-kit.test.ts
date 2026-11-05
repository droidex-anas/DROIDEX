import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

const exporter = fileURLToPath(new URL('./export-kit.mjs', import.meta.url));

// Fails only the last step of publishing: moving the finished export into place.
const FAIL_PUBLISH = `
import fs from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
const renameSync = fs.renameSync;
fs.renameSync = (from, to) => {
  if (String(from).endsWith('.export')) throw Object.assign(new Error('injected EIO'), { code: 'EIO' });
  return renameSync(from, to);
};
syncBuiltinESMExports();
`;

function contents(dir: string): Record<string, string> {
  const files = readdirSync(dir, { recursive: true, encoding: 'utf8' })
    .filter((path) => statSync(join(dir, path)).isFile())
    .sort();
  return Object.fromEntries(files.map((path) => [path, readFileSync(join(dir, path), 'base64')]));
}

test('an export that fails to publish leaves the previous preset as it was', (t) => {
  const root = mkdtempSync(join(tmpdir(), 'droidex-export-kit-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  // The tool writes beside itself, so a copy in a scratch tree never touches the real presets.
  mkdirSync(join(root, 'tools'));
  cpSync(exporter, join(root, 'tools/export-kit.mjs'));
  const preset = join(root, 'sidecar/src/canvas/presets/droidex');
  mkdirSync(join(preset, 'previews'), { recursive: true });
  writeFileSync(join(preset, 'system.json'), JSON.stringify({ name: 'DROIDEX' }));
  writeFileSync(join(preset, 'cover-light.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47]));
  writeFileSync(join(preset, 'previews/button-dark.png'), Buffer.from([1, 2, 3]));
  const kit = join(root, 'profile/canvases/design-systems/kit');
  mkdirSync(kit, { recursive: true });
  const system = { id: 'kit', version: 1, name: 'Kit', cover: null, sections: [], files: { 'index.tsx': '' }, examples: {} };
  writeFileSync(join(kit, '1.json'), JSON.stringify({ system }));
  writeFileSync(join(root, 'fail-publish.mjs'), FAIL_PUBLISH);
  const before = contents(preset);

  const result = spawnSync(
    process.execPath,
    [
      '--import',
      pathToFileURL(join(root, 'fail-publish.mjs')).href,
      join(root, 'tools/export-kit.mjs'),
      '--profile',
      join(root, 'profile'),
      '--kit',
      'kit',
    ],
    { encoding: 'utf8' },
  );

  assert.equal(result.status, 1, result.stdout + result.stderr);
  assert.deepEqual(contents(preset), before);
});
