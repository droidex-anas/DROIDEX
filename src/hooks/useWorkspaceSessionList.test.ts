import assert from 'node:assert/strict';
import test from 'node:test';

import { withRevealedCwds } from './useWorkspaceSessionList';

test('revealing folders accumulates their execution cwds and repeats change nothing', () => {
  // A folder reveals every execution cwd it can run sessions in.
  const first = withRevealedCwds([], ['/repo/app', '/repo/app/.worktrees/feature-a']);
  assert.deepEqual([...first], ['/repo/app', '/repo/app/.worktrees/feature-a']);
  assert.deepEqual([...withRevealedCwds(['/repo/app'], ['/repo/api'])], ['/repo/app', '/repo/api']);

  // An already revealed folder keeps the same list, so it is not re-requested.
  const revealed = ['/repo/app', '/repo/api'];
  assert.equal(withRevealedCwds(revealed, ['/repo/app']), revealed);
  assert.equal(withRevealedCwds(revealed, []), revealed);
});
