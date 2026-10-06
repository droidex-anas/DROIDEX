import test from 'node:test';
import assert from 'node:assert/strict';
import { removeWorktreeAndReanchor } from './worktreeRemoval';

test('linked sessions are reanchored only after the worktree is actually removed', async () => {
  for (const [result, calls, reanchored] of [
    [{ ok: false, reason: 'not_clean' }, ['remove'], 0],
    [{ ok: true, branchDeleted: true }, ['remove', 'reanchor'], 2],
  ] as const) {
    const seen: string[] = [];
    const outcome = await removeWorktreeAndReanchor(
      async () => {
        seen.push('remove');
        return result;
      },
      async () => {
        seen.push('reanchor');
        return 2;
      },
    );
    assert.deepEqual(seen, calls);
    assert.equal(outcome.result.ok, result.ok);
    assert.equal(outcome.reanchored, reanchored);
    assert.equal(outcome.reanchorFailed, false);
  }
});

test('successful removal reports a later reanchor failure separately', async () => {
  const outcome = await removeWorktreeAndReanchor(
    async () => ({ ok: true }),
    async () => {
      throw new Error('sidecar unavailable');
    },
  );

  assert.equal(outcome.result.ok, true);
  assert.equal(outcome.reanchored, 0);
  assert.equal(outcome.reanchorFailed, true);
});
