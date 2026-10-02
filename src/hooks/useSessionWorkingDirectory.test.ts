import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createWorkingDirectoryTranscriptSelector,
  isWorktreeDiscoveryStable,
} from './useSessionWorkingDirectory';
import type { GitWorktree } from '../types/vcs';
import type { TranscriptEvent } from '../types/bridge';

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
  const initial = selectTranscript({ transcripts: { s1: [toolEvent] } });
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
  });

  assert.equal(afterText, initial);
  assert.deepEqual(afterText, [toolEvent]);
});
