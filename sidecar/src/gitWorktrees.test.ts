import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { requireRealDirectoryPath } from './gitWorktrees.js';

test('requireRealDirectoryPath accepts dotdot-prefixed children', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'git-worktrees-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const child = join(root, '..foo');
  await mkdir(child);

  await assert.doesNotReject(requireRealDirectoryPath(root, child, 'outside'));
  await assert.doesNotReject(requireRealDirectoryPath(root, join(child, 'new'), 'outside'));
});
