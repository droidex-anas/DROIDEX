import assert from 'node:assert/strict';
import test from 'node:test';
import { environmentLabels } from './repoEnvironment';

test('environmentLabels shows the repo folder, branch, and change summary', () => {
  const labelsFor = (repoRoot: string, branch: string | null, changed: number) =>
    environmentLabels(repoRoot, {
      repoRoot,
      branch,
      changed,
      staged: changed ? 1 : 0,
      unstaged: changed ? 1 : 0,
      untracked: changed ? 1 : 0,
    });
  assert.deepEqual(labelsFor('/Users/anas/Documents/droid-control', 'feature/context', 3), {
    location: 'droid-control',
    branch: 'feature/context',
    changes: '3 changes',
  });
  // A clean detached or branchless repo.
  assert.deepEqual(labelsFor('/repo/app-worktree', null, 0), {
    location: 'app-worktree',
    branch: 'No branch',
    changes: 'Clean',
  });
  // Outside a repo the folder name stands alone.
  assert.deepEqual(environmentLabels('/Users/anas/Documents/plain-folder', null), {
    location: 'plain-folder',
    branch: 'No branch',
    changes: 'No repo',
  });
});
