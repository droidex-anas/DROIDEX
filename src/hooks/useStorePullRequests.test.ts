import assert from 'node:assert/strict';
import test from 'node:test';
import { initialState, reducer } from './useStore';
import { sessionSummary } from '../test/sessionSummary';

const session = (appSessionId: string) =>
  sessionSummary(appSessionId, {
    providerSessionId: `provider-${appSessionId}`,
    goal: appSessionId,
    cwd: '/workspace',
  });

test('opening pull requests binds the view, keeps a number only in its repository, and closing keeps the bind', () => {
  const selected = reducer(initialState, {
    type: 'OPEN_PULL_REQUESTS',
    cwd: '/repo-a',
    number: 12,
  });
  assert.equal(selected.mainView, 'pull-requests');
  assert.equal(selected.prWorkspaceCwd, '/repo-a');
  assert.equal(selected.prWorkspaceNumber, 12);
  const sameRepository = reducer(selected, {
    type: 'OPEN_PULL_REQUESTS',
    cwd: '/repo-a',
  });
  assert.equal(sameRepository.prWorkspaceNumber, 12);

  const differentRepository = reducer(sameRepository, {
    type: 'OPEN_PULL_REQUESTS',
    cwd: '/repo-b',
  });
  assert.equal(differentRepository.prWorkspaceCwd, '/repo-b');
  assert.equal(differentRepository.prWorkspaceNumber, null);

  const closed = reducer(selected, { type: 'CLOSE_PULL_REQUESTS' });
  assert.equal(closed.mainView, 'session');
  assert.equal(closed.prWorkspaceCwd, '/repo-a');
  assert.equal(closed.prWorkspaceNumber, 12);
});

test('backlog ids move and restore without duplicating and ignore ids that cannot persist', () => {
  const moved = reducer(initialState, { type: 'MOVE_PR_TO_BACKLOG', id: 'acme/app#12' });
  assert.deepEqual(moved.prBacklogIds, ['acme/app#12']);
  const again = reducer(moved, { type: 'MOVE_PR_TO_BACKLOG', id: 'acme/app#12' });
  assert.equal(again, moved);
  const restored = reducer(moved, { type: 'RESTORE_PR_FROM_BACKLOG', id: 'acme/app#12' });
  assert.deepEqual(restored.prBacklogIds, []);

  // An id too long to persist is ignored instead of stored.
  const oversized = reducer(initialState, {
    type: 'MOVE_PR_TO_BACKLOG',
    id: `/${'a'.repeat(200)}#1`,
  });
  assert.equal(oversized, initialState);
});

test('leaving the workspace for a session or a pull request chat draft keeps the repository target', () => {
  const open = reducer(
    {
      ...initialState,
      sessions: { a: session('a') },
      sessionOrder: ['a'],
      activeAppSessionId: 'a',
    },
    { type: 'OPEN_PULL_REQUESTS', cwd: '/repo' },
  );
  const selected = reducer(open, { type: 'SET_ACTIVE_SESSION', id: 'a' });
  assert.equal(selected.mainView, 'session');
  assert.equal(selected.prWorkspaceCwd, '/repo');

  const started = reducer(open, {
    type: 'START_CHAT',
    cwd: '/repo',
    executionMode: 'local',
  });
  const seeded = reducer(started, {
    type: 'SEED_COMPOSER',
    text: 'Help me with PR #12',
  });

  assert.equal(seeded.activeAppSessionId, null);
  assert.deepEqual(seeded.draftChat, {
    cwd: '/repo',
    executionMode: 'local',
    branch: undefined,
  });
  assert.equal(seeded.composerSeeds[0]?.text, 'Help me with PR #12');
  assert.equal(seeded.composerSeeds[0]?.appSessionId, null);
  assert.equal(seeded.mainView, 'session');
});
