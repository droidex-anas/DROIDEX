import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, mkdir, realpath, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  browserDesignReferenceDir,
  isBrowserAssetPath,
  resolveBrowserAssetPath,
} from './browserPaths.js';

test('resolveBrowserAssetPath rejects symlinks that leave the browser data root', async () => {
  const fixture = await mkdtemp(join(tmpdir(), 'droid-browser-paths-'));
  const root = join(fixture, 'browser');
  const outside = join(fixture, 'secret.txt');
  await mkdir(root);
  await writeFile(outside, 'secret');
  await symlink(outside, join(root, 'linked-secret.txt'));

  assert.equal(await resolveBrowserAssetPath(join(root, 'linked-secret.txt'), root), null);
  await writeFile(join(root, 'screenshot.png'), 'image');
  assert.equal(
    await resolveBrowserAssetPath(join(root, 'screenshot.png'), root),
    await realpath(join(root, 'screenshot.png')),
  );
});

test('browser paths sanitize session ids and admit only files below the browser data root', () => {
  assert.equal(
    browserDesignReferenceDir('app-session:one', '/tmp/droid'),
    '/tmp/droid/design-references/app-session-one',
  );
  assert.equal(isBrowserAssetPath('/tmp/droid/design-references/a/pack.json', '/tmp/droid'), true);
  assert.equal(isBrowserAssetPath('/tmp/droid-evil/shot.png', '/tmp/droid'), false);
  assert.equal(isBrowserAssetPath('/etc/passwd', '/tmp/droid'), false);
});
