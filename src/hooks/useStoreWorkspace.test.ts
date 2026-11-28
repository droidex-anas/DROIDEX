import test from 'node:test';
import assert from 'node:assert/strict';
import { initialState, reducer } from './useStore';

test('a workspace chat keeps its execution mode; a workspace-less one drops the folder and PR view', () => {
  const workspaceDraft = reducer(initialState, {
    type: 'START_CHAT',
    cwd: '/repo',
    executionMode: 'worktree',
    branch: 'main',
  });
  assert.deepEqual(workspaceDraft.draftChat, {
    cwd: '/repo',
    executionMode: 'worktree',
    branch: 'main',
  });

  const inWorkspace = reducer(workspaceDraft, { type: 'OPEN_PULL_REQUESTS', cwd: '/repo' });
  const state = reducer(inWorkspace, { type: 'START_CHAT', cwd: '', executionMode: 'local' });

  assert.deepEqual(state.draftChat, { cwd: '', executionMode: 'local', branch: undefined });
  assert.equal(state.mainView, 'session');
});

test('REORDER_WORKSPACES stores only a full permutation of the known folders', () => {
  const state = {
    ...initialState,
    workspaceCwds: ['/repo/app', '/repo/site', '/repo/api'],
  };
  const reordered = reducer(state, {
    type: 'REORDER_WORKSPACES',
    cwds: ['/repo/api', '/repo/app', '/repo/site'],
  });
  assert.deepEqual(reordered.workspaceCwds, ['/repo/api', '/repo/app', '/repo/site']);

  for (const cwds of [
    ['/repo/api', '/repo/app'],
    ['/repo/api', '/repo/app', '/repo/app'],
    ['/repo/api', '/repo/app', '/repo/unknown'],
  ]) {
    const invalid = reducer(state, { type: 'REORDER_WORKSPACES', cwds });
    assert.equal(invalid, state);
  }
});

test('REMOVE_WORKSPACE drops a listed folder and is a no-op for unknown paths', () => {
  const added = reducer(initialState, { type: 'ADD_WORKSPACE', cwd: '/repo/app' });
  const withSite = reducer(added, { type: 'ADD_WORKSPACE', cwd: '/repo/site' });
  const removed = reducer(withSite, { type: 'REMOVE_WORKSPACE', cwd: '/repo/app' });
  assert.deepEqual(removed.workspaceCwds, ['/repo/site']);
  assert.deepEqual(
    reducer(removed, { type: 'REMOVE_WORKSPACE', cwd: '/repo/gone' }).workspaceCwds,
    ['/repo/site'],
  );
});
