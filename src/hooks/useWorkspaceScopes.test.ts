import assert from 'node:assert/strict';
import test from 'node:test';
import { stable } from '../lib/stable';
import { startWorkspaceDiscovery, type WorkspaceDiscoverySnapshot } from './useWorkspaceScopes';
import type { GitWorktree } from '../types/vcs';

const worktree = (path: string, isMain = true): GitWorktree => ({
  path,
  head: null,
  branch: 'main',
  bare: false,
  detached: false,
  locked: false,
  isMain,
  isCurrent: false,
});

const RETRY_MS = 1_000;
// Far enough past RETRY_MS that any would-be retry has fired several times over.
const WELL_PAST_RETRY_MS = 10 * RETRY_MS;

/** Lets a discovery pass whose loadWorktrees promises have settled run to completion. */
const finishPass = () => new Promise<void>((resolve) => setImmediate(resolve));

test('an incomplete discovery keeps retrying without depending on snapshot churn', async (t) => {
  // Regression: the retry loop used to be re-armed by the effect re-running on
  // a NEW snapshot identity every pass, so every 5s retry re-rendered the app,
  // re-fired sessions.list, and re-grouped the sidebar even when nothing
  // changed (runaway idle CPU). The loop must reschedule itself even when the
  // published payload is identical to the previous one.
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let loads = 0;
  const published: WorkspaceDiscoverySnapshot[] = [];
  const cancel = startWorkspaceDiscovery({
    workspaceCwds: ['/repo/app', '/plain/folder'],
    key: JSON.stringify(['/repo/app', '/plain/folder']),
    startDelayMs: null,
    retryDelayMs: RETRY_MS,
    loadWorktrees: (cwd) => {
      loads += 1;
      // The plain folder never reports worktrees, so discovery stays
      // incomplete forever.
      return Promise.resolve(cwd === '/repo/app' ? [worktree('/repo/app')] : []);
    },
    publish: (snapshot) => published.push(snapshot),
    onCanonicalCwds: () => assert.fail('canonical cwds did not change'),
  });
  try {
    await finishPass();
    assert.equal(published.length, 1);
    t.mock.timers.tick(RETRY_MS);
    await finishPass();
    assert.equal(published.length, 2);
    t.mock.timers.tick(RETRY_MS);
    await finishPass();
    assert.equal(published.length, 3);
  } finally {
    cancel();
  }
  assert.ok(loads >= 6, `expected repeated discovery, saw ${String(loads)} loads`);
  // Identical retry payloads must be deep-equal so the hook's stable()
  // publish keeps the previous snapshot identity and nothing re-renders.
  assert.equal(stable(published[0], published[1]), published[0]);
  assert.equal(published[0].complete, false);
});

test('a rejected discovery pass re-arms the retry loop instead of ending it', async (t) => {
  // Regression: `discover` only rescheduled itself from the fulfillment
  // handler, so a single rejected `loadWorktrees` killed discovery permanently
  // (and surfaced as an unhandled rejection).
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let loads = 0;
  const published: WorkspaceDiscoverySnapshot[] = [];
  const cancel = startWorkspaceDiscovery({
    workspaceCwds: ['/repo/app'],
    key: JSON.stringify(['/repo/app']),
    startDelayMs: null,
    retryDelayMs: RETRY_MS,
    loadWorktrees: () => {
      loads += 1;
      return loads < 3
        ? Promise.reject(new Error('git unavailable'))
        : Promise.resolve([worktree('/repo/app')]);
    },
    publish: (snapshot) => published.push(snapshot),
    onCanonicalCwds: () => assert.fail('canonical cwds did not change'),
  });
  try {
    await finishPass();
    t.mock.timers.tick(RETRY_MS);
    await finishPass();
    t.mock.timers.tick(RETRY_MS);
    await finishPass();
  } finally {
    cancel();
  }
  assert.equal(loads, 3);
  assert.equal(published.length, 1);
  assert.equal(published[0].complete, true);
});

test('a complete discovery publishes once and stops', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const published: WorkspaceDiscoverySnapshot[] = [];
  const cancel = startWorkspaceDiscovery({
    workspaceCwds: ['/repo/app'],
    key: JSON.stringify(['/repo/app']),
    startDelayMs: null,
    retryDelayMs: RETRY_MS,
    loadWorktrees: () => Promise.resolve([worktree('/repo/app')]),
    publish: (snapshot) => published.push(snapshot),
    onCanonicalCwds: () => assert.fail('canonical cwds did not change'),
  });
  try {
    await finishPass();
    assert.equal(published.length, 1);
    // Run the clock well past the retry delay to prove no retry is armed.
    t.mock.timers.tick(WELL_PAST_RETRY_MS);
    await finishPass();
  } finally {
    cancel();
  }
  assert.equal(published.length, 1);
  assert.equal(published[0].complete, true);
  assert.deepEqual(published[0].scopes, [{ cwd: '/repo/app', executionCwds: ['/repo/app'] }]);
});

test('a canonical key change hands off instead of retrying under the stale key', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const canonical: string[][] = [];
  let loads = 0;
  const cancel = startWorkspaceDiscovery({
    workspaceCwds: ['/repo/app/.worktrees/feature', '/plain/folder'],
    key: JSON.stringify(['/repo/app/.worktrees/feature', '/plain/folder']),
    startDelayMs: null,
    retryDelayMs: RETRY_MS,
    // Incomplete AND non-canonical: the linked worktree resolves to the main
    // repository while the plain folder reports nothing, so the loop must hand
    // off via onCanonicalCwds rather than keep polling under the stale key.
    loadWorktrees: (cwd) => {
      loads += 1;
      return Promise.resolve(cwd === '/repo/app/.worktrees/feature' ? [worktree('/repo/app')] : []);
    },
    publish: () => {},
    onCanonicalCwds: (cwds) => canonical.push(cwds),
  });
  try {
    await finishPass();
    assert.equal(canonical.length, 1);
    t.mock.timers.tick(WELL_PAST_RETRY_MS);
    await finishPass();
  } finally {
    cancel();
  }
  // One discovery pass (both workspaces loaded once), then the hand-off; no
  // retry under the stale key.
  assert.equal(loads, 2);
  assert.deepEqual(canonical, [['/repo/app', '/plain/folder']]);
});

test('cancel stops the loop and drops an in-flight pass that later resolves or rejects', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  for (const outcome of ['resolve', 'reject'] as const) {
    let settle: (() => void) | undefined;
    let loads = 0;
    const published: WorkspaceDiscoverySnapshot[] = [];
    const cancel = startWorkspaceDiscovery({
      workspaceCwds: ['/repo/app'],
      key: JSON.stringify(['/repo/app']),
      startDelayMs: null,
      retryDelayMs: RETRY_MS,
      loadWorktrees: () => {
        loads += 1;
        return new Promise((resolve, reject) => {
          settle = () =>
            outcome === 'resolve'
              ? resolve([worktree('/repo/app')])
              : reject(new Error('git unavailable'));
        });
      },
      publish: (snapshot) => published.push(snapshot),
      onCanonicalCwds: () => {},
    });
    // The first pass starts synchronously and is now waiting on loadWorktrees.
    assert.ok(settle, outcome);
    cancel();
    settle();
    await finishPass();
    // A rejected pass would re-arm the retry; run the clock past it to prove it did not.
    t.mock.timers.tick(WELL_PAST_RETRY_MS);
    await finishPass();
    assert.equal(published.length, 0, outcome);
    assert.equal(loads, 1, outcome);
  }
});
