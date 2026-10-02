import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';

import { HistoryIndex, type PersistedChildSession } from './history.js';
import { HistoryPersistence } from './HistoryPersistence.js';
import { sqliteFts5UnavailableSkipReason } from './historySearchSchema.js';
import type { HistoryPersistenceClient, HistorySearchClient } from './HistoryWorkerClient.js';
import type {
  HistoryPersistenceBatch,
  HistoryPersistenceResult,
} from './historyPersistenceProtocol.js';
import type { HistorySearchReply, SessionSummary, TranscriptEvent } from './protocol.js';
import { hotPathMetrics } from './telemetry/hotPathMetrics.js';
import { providerSessionJsonl } from './testing/providerSessionFixtures.js';
import { persistTestChild } from './testing/historyPersistenceFixture.js';

const FTS5_UNAVAILABLE_REASON = sqliteFts5UnavailableSkipReason();

function withTemporaryHome(prefix: string): { home: string; restore: () => void } {
  const home = mkdtempSync(join(tmpdir(), prefix));
  const previousHome = process.env['HOME'];
  const previousUserProfile = process.env['USERPROFILE'];
  process.env['HOME'] = home;
  process.env['USERPROFILE'] = home;
  return {
    home,
    restore: () => {
      if (previousHome === undefined) delete process.env['HOME'];
      else process.env['HOME'] = previousHome;
      if (previousUserProfile === undefined) delete process.env['USERPROFILE'];
      else process.env['USERPROFILE'] = previousUserProfile;
      rmSync(home, { recursive: true, force: true });
    },
  };
}

function stubSearchClient(overrides: Partial<HistorySearchClient> = {}): HistorySearchClient {
  return {
    reconcileSessionFiles: async () => ({
      previousRevision: 0,
      revision: 0,
      changed: 0,
      upserts: [],
      removedProviderSessionIds: [],
    }),
    reconcileSessionFilePaths: async () => ({
      previousRevision: 0,
      revision: 0,
      changed: 0,
      upserts: [],
      removedProviderSessionIds: [],
    }),
    sessionFileSnapshot: async () => ({ revision: 0, changed: 0, entries: [] }),
    setIndexingIdle: async () => undefined,
    search: async () => ({ results: [], indexingIncomplete: false }),
    close: () => Promise.resolve(),
    ...overrides,
  };
}

function stubPersistenceClient(
  overrides: Partial<HistoryPersistenceClient> = {},
): HistoryPersistenceClient {
  return {
    startPersist: (batch) => ({ promise: Promise.resolve(persistResult(batch)) }),
    startDurabilityBarrier: () => ({ promise: Promise.resolve({ durable: true } as const) }),
    close: () => Promise.resolve(),
    ...overrides,
  };
}

function persistResult(batch: HistoryPersistenceBatch): HistoryPersistenceResult {
  return {
    durationMs: 1,
    eventsWritten: batch.events.length,
    summariesWritten: batch.summaries.length,
    childrenWritten: batch.children.length,
  };
}

function summary(patch: Partial<SessionSummary> = {}): SessionSummary {
  return {
    appSessionId: 'app',
    providerSessionId: 'provider',
    provider: 'droid',
    sessionPurpose: 'chat',
    interactionMode: 'auto',
    role: 'primary',
    title: 'Durable session',
    goal: 'Persist settled state',
    cwd: '/repo',
    autonomy: 'low',
    phase: 'running',
    streaming: true,
    features: [],
    tokensIn: 0,
    tokensOut: 1,
    contextTokens: 1,
    createdAt: 1,
    updatedAt: 1,
    ...patch,
  };
}

function child(status: PersistedChildSession['status']): PersistedChildSession {
  return {
    parentAppSessionId: 'app',
    childSessionId: 'child',
    role: 'worker',
    status,
    modelId: 'model',
    transcriptAvailable: true,
    updatedAt: 1,
  };
}

test('a failed settlement is held while live transcript output continues until recovery', async () => {
  const { home, restore } = withTemporaryHome('droidex-history-persistence-');
  const persistence = new HistoryPersistence();
  try {
    persistence.syncSummaries([summary()]);
    await persistence.flush();

    const invalidSettlement = summary({ phase: 'paused', streaming: false, tokensOut: 2 });
    Object.defineProperty(invalidSettlement, 'title', { value: undefined });
    assert.equal(persistence.syncSummaries([invalidSettlement]), false);
    await assert.rejects(persistence.flush(), /cannot be bound/);

    assert.doesNotThrow(() =>
      persistence.recordEvent({
        id: 'live-after-boundary-failure',
        appSessionId: 'app',
        sourceSessionId: 'app',
        role: 'primary',
        ts: 2,
        kind: 'text',
        text: 'live output continues',
      }),
    );

    assert.equal(
      persistence.syncSummaries([summary({ phase: 'paused', streaming: false, tokensOut: 2 })]),
      false,
    );
    await persistence.flush();

    const db = new DatabaseSync(join(home, '.factory', 'droidex', 'session-index.sqlite'), {
      readOnly: true,
    });
    try {
      const row = db
        .prepare('SELECT tokens_out FROM app_sessions WHERE app_session_id = ?')
        .get('app') as { tokens_out: number };
      assert.equal(row.tokens_out, 2);
    } finally {
      db.close();
    }
  } finally {
    await persistence.close();
    restore();
  }
});

test('a failed child settlement is held until a later strict boundary recovers durability', async () => {
  const { home, restore } = withTemporaryHome('droidex-child-persistence-');
  const persistence = new HistoryPersistence();
  try {
    persistence.upsertChildSession(child('running'));
    await persistence.flush();

    const invalidSettlement = child('paused');
    Object.defineProperty(invalidSettlement, 'modelId', { value: undefined });
    assert.equal(persistence.upsertChildSession(invalidSettlement), false);
    await assert.rejects(persistence.flush(), /cannot be bound/);

    assert.equal(persistence.upsertChildSession(child('paused')), false);
    await persistence.flush();

    const db = new DatabaseSync(join(home, '.factory', 'droidex', 'session-index.sqlite'), {
      readOnly: true,
    });
    try {
      const row = db
        .prepare(
          'SELECT status FROM child_sessions WHERE parent_app_session_id = ? AND child_session_id = ?',
        )
        .get('app', 'child') as { status: string };
      assert.equal(row.status, 'paused');
    } finally {
      db.close();
    }
  } finally {
    await persistence.close();
    restore();
  }
});

test('a hydrated running child replacement crosses a durability boundary', async () => {
  const { restore } = withTemporaryHome('droidex-hydrated-child-durability-');
  new HistoryIndex().close();
  persistTestChild({
    ...child('running'),
    providerSessionId: 'provider-old',
    previousProviderSessionIds: [],
  });
  const persistence = new HistoryPersistence();
  try {
    assert.equal(persistence.childSession('app', 'child')?.providerSessionId, 'provider-old');
    hotPathMetrics.reset();
    assert.equal(
      persistence.upsertChildSession({
        ...child('running'),
        providerSessionId: 'provider-new',
        previousProviderSessionIds: ['provider-old'],
      }),
      false,
    );
    await persistence.flush();
    assert.equal(hotPathMetrics.snapshot().histograms.persistenceBoundaryMs.count, 1);
  } finally {
    await persistence.close();
    hotPathMetrics.reset();
    restore();
  }
});

test(
  'search excludes session files that the canonical history cache did not admit',
  { skip: FTS5_UNAVAILABLE_REASON },
  async () => {
    const { home, restore } = withTemporaryHome('droidex-history-search-');
    const persistence = new HistoryPersistence();
    try {
      const sessionsDirectory = join(home, '.factory', 'sessions', '2026', '08');
      mkdirSync(sessionsDirectory, { recursive: true });
      writeFileSync(
        join(sessionsDirectory, 'abandoned.jsonl'),
        providerSessionJsonl(
          {
            type: 'session_start',
            cwd: '/repo',
            sessionTitle: 'Abandoned session',
            settings: { interactionMode: 'auto' },
          },
          ['user'],
        ),
      );

      await persistence.reconcileSessionFiles();

      assert.deepEqual(await persistence.searchSessions('hello'), {
        results: [],
        indexingIncomplete: false,
      });
    } finally {
      await persistence.close();
      restore();
    }
  },
);

test('search results resolve through pending in-memory provider aliases', async () => {
  const { restore } = withTemporaryHome('droidex-history-search-alias-overlay-');
  const searchClient = stubSearchClient({
    search: async () => ({
      results: [
        {
          appSessionId: 'provider',
          matches: [{ snippet: 'pending alias needle', author: 'user', ts: 1 }],
        },
      ],
      indexingIncomplete: false,
    }),
  });
  const persistence = new HistoryPersistence({ searchClient });
  try {
    persistence.syncSummaries([summary({ appSessionId: 'stable-app' })]);
    persistence.syncSummaries([
      summary({ appSessionId: 'stable-app', title: 'Pending overlay', tokensOut: 2 }),
    ]);

    assert.equal(
      (await persistence.searchSessions('needle')).results[0]?.appSessionId,
      'stable-app',
    );
  } finally {
    await persistence.close();
    restore();
  }
});

test('reconciliation awaits the index worker and applies its delta to the live historical cache', async () => {
  const { restore } = withTemporaryHome('droidex-history-worker-reconcile-');
  let reconciles = 0;
  const historical = summary({
    appSessionId: 'historical-app',
    providerSessionId: 'historical-provider',
    title: 'Worker reconciled history',
    phase: 'paused',
    streaming: false,
  });
  const searchClient = stubSearchClient({
    reconcileSessionFiles: async () => {
      reconciles += 1;
      await new Promise<void>((resolve) => setImmediate(resolve));
      return {
        previousRevision: 0,
        revision: 1,
        changed: 1,
        upserts: [
          {
            providerSessionId: 'historical-provider',
            path: '/sessions/historical-provider.jsonl',
            birthtimeMs: 1,
            mtimeMs: 2,
            sizeBytes: 3,
            settingsMtimeMs: null,
            summary: historical,
          },
        ],
        removedProviderSessionIds: [],
      };
    },
    sessionFileSnapshot: async () => ({ revision: 1, changed: 0, entries: [] }),
  });
  const persistence = new HistoryPersistence({ searchClient });
  try {
    const operation = persistence.reconcileSessionFiles();
    assert.ok(operation instanceof Promise, 'raw reconciliation stays off the caller thread');
    assert.deepEqual(persistence.listHistoricalSessions({ workspaceCwds: ['/repo'] }), []);

    assert.equal(await operation, 1);
    assert.equal(reconciles, 1);
    assert.equal(
      persistence.listHistoricalSessions({ workspaceCwds: ['/repo'] })[0]?.summary.title,
      'Worker reconciled history',
    );
  } finally {
    await persistence.close();
    restore();
  }
});

test('a reconciliation revision gap replaces the main cache from an authoritative snapshot', async () => {
  const { restore } = withTemporaryHome('droidex-history-worker-resync-');
  const oldEntry = {
    providerSessionId: 'old-provider',
    path: '/sessions/old-provider.jsonl',
    birthtimeMs: 1,
    mtimeMs: 1,
    sizeBytes: 1,
    settingsMtimeMs: null,
    summary: summary({
      appSessionId: 'old-app',
      providerSessionId: 'old-provider',
      title: 'Old session',
      phase: 'paused',
      streaming: false,
    }),
  };
  const newEntry = {
    ...oldEntry,
    providerSessionId: 'new-provider',
    path: '/sessions/new-provider.jsonl',
    summary: summary({
      appSessionId: 'new-app',
      providerSessionId: 'new-provider',
      title: 'Recovered session',
      phase: 'paused',
      streaming: false,
    }),
  };
  let snapshotRequests = 0;
  const searchClient = stubSearchClient({
    reconcileSessionFiles: async () => ({
      previousRevision: 0,
      revision: 1,
      changed: 1,
      upserts: [oldEntry],
      removedProviderSessionIds: [],
    }),
    reconcileSessionFilePaths: async () => ({
      previousRevision: 2,
      revision: 3,
      changed: 1,
      upserts: [newEntry],
      removedProviderSessionIds: [],
    }),
    sessionFileSnapshot: async () => {
      snapshotRequests += 1;
      return { revision: 3, changed: 0, entries: [newEntry] };
    },
  });
  const persistence = new HistoryPersistence({ searchClient });
  try {
    await persistence.reconcileSessionFiles();
    assert.equal(await persistence.reconcileSessionFilePaths([]), 1);
    assert.equal(snapshotRequests, 1);
    assert.deepEqual(
      persistence
        .listHistoricalSessions({ workspaceCwds: ['/repo'] })
        .map((item) => item.summary.title),
      ['Recovered session'],
    );
  } finally {
    await persistence.close();
    restore();
  }
});

test('an active search cannot delay a persistence durability boundary', async () => {
  const { restore } = withTemporaryHome('droidex-history-lanes-');
  let resolveSearch: ((reply: HistorySearchReply) => void) | undefined;
  const searchClient = stubSearchClient({
    search: () =>
      new Promise<HistorySearchReply>((resolve) => {
        resolveSearch = resolve;
      }),
  });
  const persisted: HistoryPersistenceBatch[] = [];
  const persistenceClient = stubPersistenceClient({
    startPersist: (batch) => {
      persisted.push(batch);
      return { promise: Promise.resolve(persistResult(batch)) };
    },
  });
  const persistence = new HistoryPersistence({ persistenceClient, searchClient });
  try {
    const search = persistence.searchSessions('needle');
    await new Promise<void>((resolve) => setImmediate(resolve));

    const event: TranscriptEvent = {
      id: 'during-search',
      appSessionId: 'app',
      sourceSessionId: 'app',
      role: 'primary',
      ts: 1,
      kind: 'text',
      text: 'live output',
    };
    persistence.recordEvent(event);
    await persistence.flush();

    assert.deepEqual(
      persisted.flatMap((batch) => batch.events.map((item) => item.id)),
      ['during-search'],
    );
    resolveSearch?.({ results: [], indexingIncomplete: false });
    await search;
  } finally {
    await persistence.close();
    restore();
  }
});

test('live transcript work pauses an idle history backfill until the next desktop sample', async () => {
  const { restore } = withTemporaryHome('droidex-history-idle-pause-');
  const idleStates: boolean[] = [];
  const searchClient = stubSearchClient({
    setIndexingIdle: async (isIdle) => {
      idleStates.push(isIdle);
    },
  });
  const persistence = new HistoryPersistence({ searchClient });
  try {
    await persistence.setIndexingIdle(true);
    persistence.recordEvent({
      id: 'live-event',
      appSessionId: 'app',
      sourceSessionId: 'app',
      role: 'primary',
      ts: 1,
      kind: 'text',
      text: 'live work wins',
    });
    await new Promise<void>((resolve) => setImmediate(resolve));

    assert.deepEqual(idleStates, [true, false]);
  } finally {
    await persistence.close();
    restore();
  }
});

test('desktop idle samples do not resume archive indexing while live work is active', async () => {
  const { restore } = withTemporaryHome('droidex-history-idle-active-');
  const idleStates: boolean[] = [];
  const searchClient = stubSearchClient({
    setIndexingIdle: async (isIdle) => {
      idleStates.push(isIdle);
    },
  });
  const persistence = new HistoryPersistence({ searchClient });
  try {
    persistence.syncSummaries([summary()]);
    await persistence.setIndexingIdle(true);

    persistence.syncSummaries([summary({ streaming: false })]);
    persistence.upsertChildSession(child('running'));
    await persistence.setIndexingIdle(true);

    persistence.upsertChildSession(child('completed'));
    await persistence.setIndexingIdle(true);

    assert.deepEqual(idleStates, [false, false, true]);
  } finally {
    await persistence.close();
    restore();
  }
});

test('a durability boundary does not wait for ordinary output to stop', async () => {
  const { restore } = withTemporaryHome('droidex-history-boundary-');
  const barriers: (() => void)[] = [];
  let holdBarriers = true;
  const persistenceClient = stubPersistenceClient({
    startDurabilityBarrier: () => ({
      promise: new Promise((resolve) => {
        const release = () => {
          resolve({ durable: true });
        };
        if (holdBarriers) barriers.push(release);
        else release();
      }),
    }),
  });
  const persistence = new HistoryPersistence({ persistenceClient });
  const output = (id: string): TranscriptEvent => ({
    id,
    appSessionId: 'another-chat',
    sourceSessionId: 'another-chat',
    role: 'primary',
    ts: 1,
    kind: 'text',
    text: 'live output',
  });
  const nextBarrier = async (count: number) => {
    while (barriers.length < count) await new Promise<void>((resolve) => setImmediate(resolve));
    barriers[count - 1]?.();
  };
  try {
    persistence.recordEvent(output('before'));
    const boundary = persistence.flush();
    persistence.recordEvent(output('during'));
    await nextBarrier(1);
    await boundary;
    assert.equal(barriers.length, 1);

    // Durability asked for while a boundary is in flight is a different matter:
    // that request was not in its snapshot, so it takes one more pass.
    const first = persistence.flush();
    const second = persistence.flush();
    await nextBarrier(2);
    await nextBarrier(3);
    await Promise.all([first, second]);
    assert.equal(barriers.length, 3);
  } finally {
    holdBarriers = false;
    for (const release of barriers) release();
    await persistence.close();
    restore();
  }
});

test('reconciliation drains pending commits without running a durability barrier', async () => {
  const { restore } = withTemporaryHome('droidex-history-reconcile-drain-');
  hotPathMetrics.reset();
  const persisted: string[][] = [];
  let barriers = 0;
  let allowBarrier = false;
  const persistenceClient = stubPersistenceClient({
    startPersist: (batch) => {
      persisted.push(batch.events.map((item) => item.id));
      return { promise: Promise.resolve(persistResult(batch)) };
    },
    startDurabilityBarrier: () => {
      barriers += 1;
      const promise = allowBarrier
        ? Promise.resolve({ durable: true } as const)
        : Promise.reject(new Error('unexpected barrier'));
      void promise.catch(() => undefined);
      return { promise };
    },
  });
  const persistence = new HistoryPersistence({ persistenceClient });
  try {
    persistence.recordEvent({
      id: 'pending-before-reconcile',
      appSessionId: 'app',
      sourceSessionId: 'app',
      role: 'primary',
      ts: 1,
      kind: 'text',
      text: 'live output',
    });

    await assert.doesNotReject(persistence.reconcileSessionFiles());
    assert.deepEqual(persisted, [['pending-before-reconcile']]);
    assert.equal(barriers, 0);
    assert.equal(hotPathMetrics.snapshot().histograms.persistenceBoundaryMs.count, 0);

    allowBarrier = true;
    await persistence.flush();
    assert.equal(barriers, 1);
    assert.equal(hotPathMetrics.snapshot().histograms.persistenceBoundaryMs.count, 1);
  } finally {
    allowBarrier = true;
    await persistence.close();
    hotPathMetrics.reset();
    restore();
  }
});

test('forgetSession removes live summary and child overlays', async () => {
  const { restore } = withTemporaryHome('droidex-history-forget-');
  const persistenceClient = stubPersistenceClient();
  const persistence = new HistoryPersistence({ persistenceClient });
  try {
    persistence.syncSummaries([summary()]);
    persistence.syncSummaries([summary({ tokensIn: 2 })]);
    persistence.upsertChildSession(child('running'));

    assert.equal(persistence.summaryPatchesAndHidden().patches.get('app')?.tokensIn, 2);
    assert.deepEqual(
      persistence.childSessions('app').map((item) => item.childSessionId),
      ['child'],
    );

    persistence.forgetSession('app');

    assert.equal(persistence.summaryPatchesAndHidden().patches.has('app'), false);
    assert.deepEqual(persistence.childSessions('app'), []);
  } finally {
    await persistence.close();
    restore();
  }
});

test('persistence reports degraded state once and reports recovery after retained work commits', async () => {
  const { restore } = withTemporaryHome('droidex-history-status-');
  const statuses: string[] = [];
  let attempts = 0;
  const persistenceClient = stubPersistenceClient({
    startPersist: (batch) => {
      attempts += 1;
      return {
        promise:
          attempts === 1
            ? Promise.reject(new Error('worker exited'))
            : Promise.resolve(persistResult(batch)),
      };
    },
  });
  const searchClient = stubSearchClient();
  const persistence = new HistoryPersistence({
    persistenceClient,
    searchClient,
    onStatusChanged: (status) => statuses.push(status.state),
  });
  const first: TranscriptEvent = {
    id: 'one',
    appSessionId: 'app',
    sourceSessionId: 'app',
    role: 'primary',
    ts: 1,
    kind: 'text',
    text: 'one',
  };
  try {
    persistence.recordEvent(first);
    await assert.rejects(async () => await persistence.flush(), /worker exited/);
    assert.doesNotThrow(() => persistence.recordEvent({ ...first, id: 'two', text: 'two' }));
    await persistence.flush();

    assert.deepEqual(statuses, ['degraded', 'healthy']);
  } finally {
    await persistence.close();
    restore();
  }
});

test('the search worker starts only when warmed or first searched, never for persistence', async () => {
  const { restore } = withTemporaryHome('droidex-lazy-search-worker-');
  let searchWorkersCreated = 0;
  let searchCalls = 0;
  let reconcileCalls = 0;
  const searchClient = stubSearchClient();
  const persistence = new HistoryPersistence({
    createSearchClient: () => {
      searchWorkersCreated += 1;
      return {
        ...searchClient,
        async search(query: string) {
          searchCalls += 1;
          return searchClient.search(query);
        },
        async reconcileSessionFiles() {
          reconcileCalls += 1;
          return searchClient.reconcileSessionFiles();
        },
      };
    },
  });
  try {
    await persistence.flush();
    assert.equal(searchWorkersCreated, 0);

    persistence.warmSearchWorker();
    assert.equal(searchWorkersCreated, 1);
    assert.equal(searchCalls, 0);
    assert.equal(reconcileCalls, 0);

    await persistence.searchSessions('needle');
    assert.equal(searchWorkersCreated, 1);
    assert.equal(searchCalls, 1);
  } finally {
    await persistence.close();
    restore();
  }
});
