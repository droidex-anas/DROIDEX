import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createWorkingDirectoryTranscriptSelector,
  isWorktreeDiscoveryStable,
} from './useSessionWorkingDirectory';
import type { GitWorktree } from '../types/vcs';
import type { TranscriptEvent } from '../types/bridge';
import { initialState, reducer } from './useStore';
import { withUpdatedTranscript } from '../lib/transcriptStoreMemory';
import { textEvent } from '../test/textEvent';

const worktree = (path: string): GitWorktree => ({
  path,
  head: 'abc',
  branch: 'main',
  bare: false,
  detached: false,
  locked: false,
  isMain: true,
  isCurrent: true,
});

// isWorktreeDiscoveryStable decides whether the hook's git-worktree probe can
// stop re-running. Empty results use a cooldown because getGitWorktrees cannot
// distinguish a transient Git/IPC failure from a genuine non-repository.
test('worktree discovery settles on a matching snapshot and retries empty results after a cooldown', () => {
  const snapshot = {
    sessionKey: 's1',
    cwd: '/repo',
    revision: 'r1',
    worktrees: [worktree('/repo')],
    discoveredAt: 1_000,
  };
  assert.equal(isWorktreeDiscoveryStable(snapshot, 's1', '/repo', 'r1', 1_000), true);
  assert.equal(isWorktreeDiscoveryStable(null, 's1', '/repo', 'r1'), false);
  // A snapshot for a different session, cwd, or revision is not settled.
  assert.equal(isWorktreeDiscoveryStable(snapshot, 's2', '/repo', 'r1', 1_000), false);
  assert.equal(isWorktreeDiscoveryStable(snapshot, 's1', '/other', 'r1', 1_000), false);
  assert.equal(isWorktreeDiscoveryStable(snapshot, 's1', '/repo', 'r2', 1_000), false);

  const empty = { ...snapshot, worktrees: [] };
  assert.equal(isWorktreeDiscoveryStable(empty, 's1', '/repo', 'r2', 5_999), true);
  assert.equal(isWorktreeDiscoveryStable(empty, 's1', '/repo', 'r2', 6_000), false);
});

test('working-directory transcript selection ignores streamed text-only updates', () => {
  const toolEvent: TranscriptEvent = {
    id: 'tool-1',
    appSessionId: 's1',
    sourceSessionId: 's1',
    role: 'primary',
    ts: 1_000,
    kind: 'tool_call',
    toolName: 'Create',
  };
  const selectTranscript = createWorkingDirectoryTranscriptSelector('s1');
  const initial = selectTranscript({ transcripts: { s1: [toolEvent] }, transcriptMutations: {} });
  const afterText = selectTranscript({
    transcripts: {
      s1: [
        toolEvent,
        {
          id: 'text-1',
          appSessionId: 's1',
          sourceSessionId: 's1',
          role: 'primary',
          ts: 2_000,
          kind: 'text',
          text: 'streaming',
        },
      ],
    },
    transcriptMutations: {
      s1: {
        kind: 'append',
        previousLength: 1,
        firstChangedIndex: 1,
        baseRevision: 0,
        revision: 1,
      },
    },
  });

  assert.equal(afterText, initial);
  assert.deepEqual(afterText, [toolEvent]);
});

test('working-directory evidence follows tool corrections, prepends and resets for each source', () => {
  for (const sourceSessionId of [undefined, 'child']) {
    const tool = textEvent('tool', {
      appSessionId: 's1',
      sourceSessionId: sourceSessionId ?? 's1',
      role: sourceSessionId ? 'worker' : 'primary',
      kind: 'tool_call',
      toolName: 'Create',
      toolUseId: 'create-1',
      toolArgs: { cwd: '/repo' },
    });
    const select = createWorkingDirectoryTranscriptSelector('s1', sourceSessionId);
    let state = reducer(initialState, { type: 'SESSION_TRANSCRIPT', event: tool });
    const initial = select(state);
    state = reducer(state, {
      type: 'SESSION_TRANSCRIPT',
      event: textEvent('text', { appSessionId: 's1' }),
    });
    assert.equal(select(state), initial);
    state = reducer(state, {
      type: 'SESSION_TRANSCRIPT',
      event: textEvent('other', { appSessionId: 's2' }),
    });
    assert.equal(select(state), initial);

    state = reducer(state, {
      type: 'SESSION_TRANSCRIPT',
      event: { ...tool, id: 'correction', toolArgs: { cwd: '/worktree' } },
    });
    const corrected = select(state);
    assert.deepEqual(
      corrected.map((event) => event.toolArgs),
      [{ cwd: '/worktree' }],
    );
    const older = { ...tool, id: 'older', toolUseId: 'older', toolArgs: { cwd: '/older' } };
    const previous = state.transcripts.s1;
    state = withUpdatedTranscript(state, 's1', [older, ...previous], 0, {
      mutation: {
        kind: 'prepend',
        previousLength: previous.length,
        firstChangedIndex: 0,
        insertedCount: 1,
      },
    });
    assert.deepEqual(
      select(state).map((event) => event.toolArgs),
      [{ cwd: '/older' }, { cwd: '/worktree' }],
    );
    state = withUpdatedTranscript(state, 's1', [tool], 0);
    assert.deepEqual(select(state), [tool]);
    state = withUpdatedTranscript(state, 's1', [], 0);
    assert.deepEqual(select(state), []);
  }
});
