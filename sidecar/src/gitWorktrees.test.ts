import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { requireRealDirectoryPath } from './gitWorktrees.js';

test('requireRealDirectoryPath accepts dotdot-prefixed children without allowing escapes', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'git-worktrees-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const child = join(root, '..foo');
  await mkdir(child);

  await assert.doesNotReject(requireRealDirectoryPath(root, child, 'outside'));
  await assert.doesNotReject(requireRealDirectoryPath(root, join(child, 'new'), 'outside'));
  for (const outside of [root, join(root, '..'), `${root}-sibling`]) {
    await assert.rejects(requireRealDirectoryPath(root, outside, 'outside'), /outside/);
  }
  await symlink(root, join(child, 'link'));
  await assert.rejects(
    requireRealDirectoryPath(root, join(child, 'link', 'nested'), 'outside'),
    /not a real directory/,
  );
});
