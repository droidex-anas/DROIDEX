import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';

import type * as Protocol from './protocol.js';
import type { SessionFileChange } from './sessionFileCache.js';
import { SessionFileServing } from './SessionFileServing.js';
import type { SessionFileWatcherOptions } from './sessionFileWatcher.js';
import { FakeFactorySession } from './testing/fakeFactoryRuntime.js';
import {
  createSessionManagerTestContext,
  type SessionManagerTestContext,
} from './testing/sessionManagerTestContext.js';
import {
  providerSessionJsonl,
  type ProviderMessageRole,
} from './testing/providerSessionFixtures.js';

// Writes a session file with no app involvement, like a Droid CLI run or a
// parallel app instance would.
function writeExternalSession(
  home: string,
  id: string,
  cwd: string,
  messageRoles: ProviderMessageRole[] = ['user', 'assistant'],
): SessionFileChange {
  const path = join(home, '.factory', 'sessions', '2026', '08', `${id}.jsonl`);
  mkdirSync(join(path, '..'), { recursive: true });
  writeFileSync(
    path,
    providerSessionJsonl(
      {
        type: 'session_start',
        cwd,
        sessionTitle: 'External CLI session',
        settings: { interactionMode: 'auto' },
      },
      messageRoles,
    ),
  );
  return { providerSessionId: id, path };
}

// Captures the watcher callbacks the manager registers so a test can play the
// part of the file system.
function withCapturedWatcher(
  consumeLiveSessionFile: (providerSessionId: string) => string | undefined = () => undefined,
) {
  let options: SessionFileWatcherOptions | undefined;
  let closed = false;
  const ctx = createSessionManagerTestContext({
    startSessionFileWatcher: (watcherOptions) => {
      options = watcherOptions;
      return {
        liveSessionFile: () => undefined,
        consumeLiveSessionFile,
        close: () => {
          closed = true;
        },
      };
    },
  });
  const fire = (changes: SessionFileChange[] | null): void => {
    assert.ok(options, 'the watcher starts with the first sessions.list');
    options.onExternalChange(changes);
  };
  return { ctx, fire, closed: () => closed };
}

const lists = (ctx: SessionManagerTestContext) =>
  ctx.events.filter(
    (event): event is Extract<Protocol.ServerEvent, { type: 'sessions.list' }> =>
      event.type === 'sessions.list',
  );

const listed = (ctx: SessionManagerTestContext, appSessionId: string): boolean =>
  lists(ctx)
    .at(-1)
    ?.sessions.some((session) => session.appSessionId === appSessionId) ?? false;

test('sessions created outside the app are republished live when the watcher fires', async () => {
  const { ctx, fire, closed } = withCapturedWatcher();
  try {
    await ctx.handle({ type: 'sessions.list' });
    const listsBefore = lists(ctx).length;

    const change = writeExternalSession(ctx.home, 'external-session-1', '/tmp/external-workspace');
    const empty = writeExternalSession(ctx.home, 'empty-external', '/tmp/external-workspace', []);
    fire([change, empty]);
    await ctx.waitForIdle();

    assert.deepEqual(
      ctx.history.targetedReconcileCalls,
      [[change, empty]],
      'a targeted change list reconciles exactly the reported files',
    );
    assert.equal(ctx.history.fullReconcileCalls, 1, 'only the boot reconcile walks the tree');
    assert.equal(lists(ctx).length, listsBefore + 1, 'external change republishes the list');
    assert.equal(listed(ctx, 'external-session-1'), true);
    assert.equal(
      listed(ctx, 'empty-external'),
      false,
      'metadata-only sessions never become sidebar rows',
    );
  } finally {
    await ctx.dispose();
  }
  assert.equal(closed(), true, 'watcher closes on shutdown');
});

test('a live first turn stays visible before the provider writes its response', async () => {
  const ctx = createSessionManagerTestContext();
  try {
    await ctx.create({
      cwd: '/tmp/live-first-turn',
      sessionPurpose: 'chat',
      clientRef: 'live-first-turn',
      title: 'Live first turn',
      goal: 'hello',
      interactionMode: 'auto',
      autonomy: 'low',
    });

    await ctx.handle({ type: 'sessions.list', workspaceCwds: ['/tmp/live-first-turn'] });

    assert.equal(listed(ctx, 'provider-1'), true);
  } finally {
    await ctx.dispose();
  }
});

test('unexplained watcher events fall back to a full reconcile before republishing', async () => {
  const { ctx, fire } = withCapturedWatcher();
  try {
    await ctx.handle({ type: 'sessions.list' });
    const fullReconcilesBefore = ctx.history.fullReconcileCalls;

    fire(null);
    await ctx.waitForIdle();

    assert.equal(ctx.history.fullReconcileCalls, fullReconcilesBefore + 1);
    assert.equal(ctx.history.targetedReconcileCalls.length, 0);
  } finally {
    await ctx.dispose();
  }
});

test('a failed watcher reconcile marks the next list for an authoritative full retry', async () => {
  const { ctx, fire } = withCapturedWatcher();
  try {
    await ctx.handle({ type: 'sessions.list' });
    const listsBefore = lists(ctx).length;
    ctx.history.failNextTargetedReconcile = new Error('derived database busy');
    fire([{ providerSessionId: 'failed-watcher-session', path: '/tmp/failed-watcher.jsonl' }]);
    await ctx.waitForIdle();

    assert.equal(lists(ctx).length, listsBefore, 'a failed delta never republishes a stale list');
    await ctx.handle({ type: 'sessions.list' });
    assert.equal(ctx.history.fullReconcileCalls, 2, 'the next list performs a full retry');
    assert.equal(lists(ctx).length, listsBefore + 1);
  } finally {
    await ctx.dispose();
  }
});

test('closing a live session reconciles its final file before republishing', async () => {
  const workspace = '/tmp/finalized-workspace';
  let finalizedSessionFile: string | undefined;
  const { ctx } = withCapturedWatcher(() => finalizedSessionFile);
  try {
    await ctx.create({
      cwd: workspace,
      sessionPurpose: 'chat',
      clientRef: 'finalized-session',
      title: 'Finalized session',
      goal: 'finish',
      interactionMode: 'auto',
      autonomy: 'low',
    });
    finalizedSessionFile = writeExternalSession(ctx.home, 'provider-1', workspace).path;
    await ctx.handle({ type: 'sessions.list', workspaceCwds: [workspace] });
    const reconcilesBeforeClose = ctx.history.fullReconcileCalls;
    const targetedReconcilesBeforeClose = ctx.history.targetedReconcileCalls.length;

    await ctx.handle({ type: 'session.close', appSessionId: 'provider-1' });

    assert.equal(
      ctx.history.fullReconcileCalls,
      reconcilesBeforeClose,
      'an observed live file does not trigger a full sessions-tree walk on close',
    );
    assert.deepEqual(
      ctx.history.targetedReconcileCalls.slice(targetedReconcilesBeforeClose),
      [[{ providerSessionId: 'provider-1', path: finalizedSessionFile }]],
      'close reconciles only the finalized file after the live registry entry is removed',
    );
    const list = lists(ctx).at(-1);
    assert.ok(list);
    assert.ok(
      list.sessions.some((session) => session.appSessionId === 'provider-1'),
      'the post-close list retains the newly historical session',
    );
    assert.ok(
      list.sessions.every((session) => session.cwd === workspace),
      'the post-close list preserves the renderer active workspace filter',
    );
  } finally {
    await ctx.dispose();
  }
});

test('provider replacement finalizes the retired file without treating its alias as live', async () => {
  const consumedProviderSessionIds: string[] = [];
  const retiredPath = '/tmp/provider-1.jsonl';
  const { ctx } = withCapturedWatcher((providerSessionId) => {
    consumedProviderSessionIds.push(providerSessionId);
    return providerSessionId === 'provider-1' ? retiredPath : undefined;
  });
  try {
    await ctx.create({
      cwd: '/tmp/compacted-workspace',
      sessionPurpose: 'chat',
      clientRef: 'compacted-session',
      title: 'Compacted session',
      goal: 'compact',
      interactionMode: 'auto',
      autonomy: 'low',
    });
    await ctx.waitForIdle();
    await ctx.handle({ type: 'sessions.list' });
    const targetedBefore = ctx.history.targetedReconcileCalls.length;
    ctx.provider.session('provider-1').nextCompactResult = {
      newSessionId: 'provider-2',
      removedCount: 1,
    };
    ctx.runtime.loadQueue.set('provider-2', [new FakeFactorySession('provider-2', {}, ctx.calls)]);

    await ctx.handle({ type: 'session.compact', appSessionId: 'provider-1' });
    await ctx.waitForIdle();

    assert.deepEqual(consumedProviderSessionIds, ['provider-1']);
    assert.deepEqual(ctx.history.targetedReconcileCalls.slice(targetedBefore), [
      [{ providerSessionId: 'provider-1', path: retiredPath }],
    ]);
  } finally {
    await ctx.dispose();
  }
});

test('watchers start once per boot, not per sessions.list command', async () => {
  const roots = new Set<string | undefined>();
  let starts = 0;
  const ctx = createSessionManagerTestContext({
    startSessionFileWatcher: (options) => {
      roots.add(options.root);
      starts += 1;
      return {
        liveSessionFile: () => undefined,
        consumeLiveSessionFile: () => undefined,
        close: () => {},
      };
    },
  });
  try {
    await ctx.handle({ type: 'sessions.list' });
    await ctx.handle({ type: 'sessions.list' });
    await ctx.handle({ type: 'sessions.list' });
    // One per scanned session-file root: Droid's tree and the provider transcripts.
    assert.equal(starts, 2);
    assert.equal(roots.size, 2);
  } finally {
    await ctx.dispose();
  }
});

test('history idle commands forward the exact desktop activity state', async () => {
  const ctx = createSessionManagerTestContext();
  try {
    await ctx.handle({ type: 'history.indexingIdle', isIdle: true });
    await ctx.handle({ type: 'history.indexingIdle', isIdle: false });

    assert.deepEqual(ctx.history.indexingIdleStates, [true, false]);
  } finally {
    await ctx.dispose();
  }
});

test('the first sessions.list resolves only after the boot reconcile publishes', async () => {
  const ctx = createSessionManagerTestContext();
  try {
    ctx.history.sessionFileCacheSize = 2;
    writeExternalSession(ctx.home, 'boot-external-session', '/tmp/boot-workspace');

    await ctx.handle({ type: 'sessions.list' });
    assert.equal(lists(ctx).length, 1, 'the command resolves after publishing the reconciled list');
    assert.equal(ctx.history.fullReconcileCalls, 1, 'the boot reconcile ran exactly once');
    assert.ok(
      listed(ctx, 'boot-external-session'),
      'the first list already includes sessions created while the app was away',
    );

    await ctx.handle({ type: 'sessions.list' });
    assert.equal(lists(ctx).length, 2, 'lists after the boot reconcile are served immediately');
  } finally {
    await ctx.dispose();
  }
});

test('sessions.list commands queued during the boot reconcile emit only the latest', async () => {
  const ctx = createSessionManagerTestContext();
  try {
    ctx.history.sessionFileCacheSize = 2;
    writeExternalSession(ctx.home, 'queued-first-session', '/tmp/first');
    writeExternalSession(ctx.home, 'queued-second-session', '/tmp/second');
    const first = ctx.handle({ type: 'sessions.list', workspaceCwds: ['/tmp/first'] });
    const second = ctx.handle({ type: 'sessions.list', workspaceCwds: ['/tmp/second'] });
    await Promise.all([first, second]);
    assert.equal(lists(ctx).length, 1, 'only the latest queued request emits after the reconcile');
    assert.equal(ctx.history.fullReconcileCalls, 1);
    assert.ok(listed(ctx, 'queued-second-session'), 'the emit uses the latest request filter');
    assert.equal(
      listed(ctx, 'queued-first-session'),
      false,
      'the superseded request filter is not used',
    );
  } finally {
    await ctx.dispose();
  }
});

test('a boot reconcile failure rejects the stale list and retries on the next request', async () => {
  const ctx = createSessionManagerTestContext();
  try {
    ctx.history.sessionFileCacheSize = 2;
    ctx.history.failNextReconcile = new Error('sqlite busy');
    await assert.rejects(ctx.handle({ type: 'sessions.list' }), /sqlite busy/);
    assert.equal(lists(ctx).length, 0, 'a failed authoritative reconcile never publishes');

    await ctx.handle({ type: 'sessions.list' });
    assert.equal(lists(ctx).length, 1, 'the next request retries once the cache is authoritative');
    assert.equal(ctx.history.fullReconcileCalls, 2);
  } finally {
    await ctx.dispose();
  }
});

test('a seeded cwd patch is respected before workspace filtering', async () => {
  const ctx = createSessionManagerTestContext();
  try {
    // The on-disk session belongs to workspace A...
    writeExternalSession(ctx.home, 'moved-session', '/workspace-on-disk');
    // ...but a persisted app-session patch moves it to workspace B.
    ctx.fixture.seedHistorySummaries([
      {
        appSessionId: 'moved-session',
        providerSessionId: 'moved-session',
        provider: 'droid',
        sessionPurpose: 'chat',
        interactionMode: 'auto',
        role: 'primary',
        title: 'Moved session',
        goal: 'Moved session',
        cwd: '/workspace-patched',
        workspaceKind: 'folder',
        autonomy: 'low',
        phase: 'paused',
        features: [],
        tokensIn: 0,
        tokensOut: 0,
        contextTokens: 0,
        createdAt: 1,
        updatedAt: 1,
      },
    ]);

    await ctx.handle({ type: 'sessions.list', workspaceCwds: ['/workspace-patched'] });
    assert.ok(listed(ctx, 'moved-session'), 'the patched cwd matches the requested workspace');

    await ctx.handle({ type: 'sessions.list', workspaceCwds: ['/workspace-on-disk'] });
    assert.equal(
      listed(ctx, 'moved-session'),
      false,
      'the session no longer belongs to its pre-patch workspace',
    );
  } finally {
    await ctx.dispose();
  }
});

test('a watcher event during the worker boot reconcile is replayed before the first list', async () => {
  const { ctx, fire } = withCapturedWatcher();
  try {
    ctx.history.sessionFileCacheSize = 2;
    const change = writeExternalSession(ctx.home, 'boot-window-session', '/tmp/boot-window');
    const firstList = ctx.handle({ type: 'sessions.list', workspaceCwds: ['/tmp/boot-window'] });
    // The boot reconcile is still pending. Changes in this window are held
    // and replayed after the full scan because the scan may already have
    // passed the changed path.
    fire([change]);
    assert.equal(
      ctx.history.fullReconcileCalls,
      0,
      'a watcher reconcile is not scheduled during the boot window',
    );
    await firstList;
    assert.equal(lists(ctx).length, 1, 'only the authoritative boot reconcile list is emitted');
    assert.equal(ctx.history.fullReconcileCalls, 1);
    assert.deepEqual(ctx.history.targetedReconcileCalls, [[change]]);
  } finally {
    await ctx.dispose();
  }
});

test('shutdown waits for an active watcher reconcile and suppresses its republish', async () => {
  let releaseReconcile: (() => void) | undefined;
  let markReconcileStarted: (() => void) | undefined;
  const reconcileStarted = new Promise<void>((resolve) => {
    markReconcileStarted = resolve;
  });
  const reconcileGate = new Promise<void>((resolve) => {
    releaseReconcile = resolve;
  });
  const { ctx, fire } = withCapturedWatcher();
  try {
    await ctx.handle({ type: 'sessions.list' });
    const reconcile = ctx.history.reconcileSessionFilePaths.bind(ctx.history);
    ctx.history.reconcileSessionFilePaths = async (changes) => {
      await reconcile(changes);
      markReconcileStarted?.();
      await reconcileGate;
      return 0;
    };
    const listsBefore = lists(ctx).length;

    fire([{ providerSessionId: 'external-during-shutdown', path: '/tmp/external.jsonl' }]);
    await reconcileStarted;
    let shutdownSettled = false;
    const shutdown = ctx.shutdown().then(() => {
      shutdownSettled = true;
    });
    await new Promise<void>((resolve) => setImmediate(resolve));
    assert.equal(shutdownSettled, false, 'history stays open until the active reconcile settles');

    releaseReconcile?.();
    await shutdown;
    assert.equal(
      lists(ctx).length,
      listsBefore,
      'a reconcile that finishes during shutdown does not publish renderer state',
    );
  } finally {
    releaseReconcile?.();
    await ctx.dispose();
  }
});

test('whenBootReconciled shares the in-flight boot reconcile without publishing a list', async () => {
  let reconcileCalls = 0;
  let emitted = 0;
  let release: (() => void) | undefined;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const serving = new SessionFileServing({
    history: {
      async reconcileSessionFiles() {
        reconcileCalls += 1;
        await gate;
        return 1;
      },
      async reconcileSessionFilePaths() {
        return 0;
      },
    },
    startWatcher: () => null,
    isLiveSession: () => false,
    isShutdownStarted: () => false,
    retryPendingLaunchSettings: () => undefined,
    listSummaries: () => ({ sessions: [] as Protocol.SessionSummary[], earlierSessionsByCwd: {} }),
    emitList: () => {
      emitted += 1;
    },
  });

  serving.start();
  let settled = false;
  const ready = serving.whenBootReconciled().then(() => {
    settled = true;
  });
  await Promise.resolve();
  assert.equal(settled, false);
  release?.();
  await ready;
  assert.equal(emitted, 0);
  assert.equal(reconcileCalls, 1, 'start and restore share one boot reconcile');
});

test('sessions.search answers the requester with indexed results and their completeness', async () => {
  const ctx = createSessionManagerTestContext();
  try {
    ctx.history.nextSearchResults = [
      {
        appSessionId: 'app-1',
        matches: [{ snippet: '…hi bro whatsapp…', author: 'user', ts: 1_700_000_000_000 }],
      },
    ];
    ctx.history.nextIndexingIncomplete = true;

    await ctx.handle({ type: 'sessions.search', requestId: 'req-7', query: 'whatsapp' });

    const reply = ctx.events.find((event) => event.type === 'sessions.searchResults');
    assert.equal(reply?.type, 'sessions.searchResults');
    assert.equal(reply.requestId, 'req-7');
    assert.equal(reply.indexingIncomplete, true);
    assert.equal(ctx.history.lastSearchQuery, 'whatsapp');
    assert.deepEqual(reply.results, ctx.history.nextSearchResults);
  } finally {
    await ctx.dispose();
  }
});

test('a superseded sessions.search scan does not emit its results', async () => {
  const ctx = createSessionManagerTestContext();
  try {
    // Gate the scan so the newer query lands while the older one is in
    // flight; determinism comes from the gate, not from timing.
    let release = (): void => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    ctx.history.searchSessions = async (
      _query?: string,
      isStale?: () => boolean,
    ): Promise<Protocol.HistorySearchReply> => {
      await gate;
      return {
        results: isStale?.()
          ? []
          : [{ appSessionId: 'app-1', matches: [{ snippet: 'hit', author: 'user', ts: 1 }] }],
        indexingIncomplete: false,
      };
    };

    const first = ctx.handle({ type: 'sessions.search', requestId: 'req-1', query: 'a' });
    const second = ctx.handle({ type: 'sessions.search', requestId: 'req-2', query: 'ab' });
    release();
    await Promise.all([first, second]);

    const replies = ctx.events.filter((event) => event.type === 'sessions.searchResults');
    assert.equal(replies.length, 1);
    assert.equal(replies[0]?.requestId, 'req-2');
  } finally {
    await ctx.dispose();
  }
});
