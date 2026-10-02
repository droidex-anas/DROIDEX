import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import test, { type TestContext } from 'node:test';

import { HistoryIndex, type PersistedChildSession } from './history.js';
import { HistoryPersistence, type HistoryPersistenceOptions } from './HistoryPersistence.js';
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
import { sessionSummary } from './testing/sessionSummaryFixture.js';

const FTS5_UNAVAILABLE_REASON = sqliteFts5UnavailableSkipReason();

/**
 * A HistoryPersistence over an empty HOME, closed when the test ends. `seed`
 * runs against that HOME before the persistence opens it.
 */
function openPersistence(
  t: TestContext,
  options: HistoryPersistenceOptions = {},
  seed?: () => void,
): { home: string; persistence: HistoryPersistence } {
  const home = mkdtempSync(join(tmpdir(), 'droidex-history-persistence-'));
  const previousHome = process.env.HOME;
  process.env.HOME = home;
  seed?.();
  const persistence = new HistoryPersistence(options);
  t.after(async () => {
    await persistence.close();
    process.env.HOME = previousHome;
    rmSync(home, { recursive: true, force: true });
  });
  return { home, persistence };
}

const emptyReconciliation = {
  previousRevision: 0,
  revision: 0,
  changed: 0,
  upserts: [],
  removedProviderSessionIds: [],
};

function stubSearchClient(overrides: Partial<HistorySearchClient> = {}): HistorySearchClient {
  return {
    reconcileSessionFiles: async () => emptyReconciliation,
    reconcileSessionFilePaths: async () => emptyReconciliation,
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
  return sessionSummary({
    providerSessionId: 'provider',
    title: 'Durable session',
    cwd: '/repo',
    phase: 'running',
    streaming: true,
    tokensOut: 1,
    contextTokens: 1,
    ...patch,
  });
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

function output(id: string, appSessionId = 'app'): TranscriptEvent {
  return {
    id,
    appSessionId,
    sourceSessionId: appSessionId,
    role: 'primary',
    ts: 1,
    kind: 'text',
    text: 'live output',
  };
}

function readRow<T>(home: string, sql: string, ...params: string[]): T {
  const db = new DatabaseSync(join(home, '.factory', 'droidex', 'session-index.sqlite'), {
    readOnly: true,
  });
  try {
    return db.prepare(sql).get(...params) as T;
  } finally {
    db.close();
  }
}

test('a failed settlement is held while live transcript output continues until recovery', async (t) => {
  const { home, persistence } = openPersistence(t);
  persistence.syncSummaries([summary()]);
  await persistence.flush();

  const invalidSettlement = summary({ phase: 'paused', streaming: false, tokensOut: 2 });
  Object.defineProperty(invalidSettlement, 'title', { value: undefined });
  assert.equal(persistence.syncSummaries([invalidSettlement]), false);
  await assert.rejects(persistence.flush(), /cannot be bound/);

  assert.doesNotThrow(() => persistence.recordEvent(output('live-after-boundary-failure')));

  assert.equal(
    persistence.syncSummaries([summary({ phase: 'paused', streaming: false, tokensOut: 2 })]),
    false,
  );
  await persistence.flush();
  const row = readRow<{ tokens_out: number }>(
    home,
    'SELECT tokens_out FROM app_sessions WHERE app_session_id = ?',
    'app',
  );
  assert.equal(row.tokens_out, 2);
});

test('a failed child settlement is held until a later strict boundary recovers durability', async (t) => {
  const { home, persistence } = openPersistence(t);
  persistence.upsertChildSession(child('running'));
  await persistence.flush();

  const invalidSettlement = child('paused');
  Object.defineProperty(invalidSettlement, 'modelId', { value: undefined });
  assert.equal(persistence.upsertChildSession(invalidSettlement), false);
  await assert.rejects(persistence.flush(), /cannot be bound/);

  assert.equal(persistence.upsertChildSession(child('paused')), false);
  await persistence.flush();
  const row = readRow<{ status: string }>(
    home,
    'SELECT status FROM child_sessions WHERE parent_app_session_id = ? AND child_session_id = ?',
    'app',
    'child',
  );
  assert.equal(row.status, 'paused');
});

test('a hydrated running child replacement crosses a durability boundary', async (t) => {
  const { persistence } = openPersistence(t, {}, () => {
    new HistoryIndex().close();
    persistTestChild({
      ...child('running'),
      providerSessionId: 'provider-old',
      previousProviderSessionIds: [],
    });
  });
  t.after(() => hotPathMetrics.reset());
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
});

test(
  'search excludes session files that the canonical history cache did not admit',
  { skip: FTS5_UNAVAILABLE_REASON },
  async (t) => {
    const { home, persistence } = openPersistence(t);
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
  },
);

test('search results resolve through pending in-memory provider aliases', async (t) => {
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
  const { persistence } = openPersistence(t, { searchClient });
  persistence.syncSummaries([summary({ appSessionId: 'stable-app' })]);
  persistence.syncSummaries([
    summary({ appSessionId: 'stable-app', title: 'Pending overlay', tokensOut: 2 }),
  ]);

  assert.equal((await persistence.searchSessions('needle')).results[0]?.appSessionId, 'stable-app');
});

function historicalEntry(id: string, title: string) {
  return {
    providerSessionId: `${id}-provider`,
    path: `/sessions/${id}-provider.jsonl`,
    birthtimeMs: 1,
    mtimeMs: 2,
    sizeBytes: 3,
    settingsMtimeMs: null,
    summary: summary({
      appSessionId: `${id}-app`,
      providerSessionId: `${id}-provider`,
      title,
      phase: 'paused',
      streaming: false,
    }),
  };
}

test('reconciliation awaits the index worker and applies its delta to the live historical cache', async (t) => {
  let reconciles = 0;
  const searchClient = stubSearchClient({
    reconcileSessionFiles: async () => {
      reconciles += 1;
      await new Promise<void>((resolve) => setImmediate(resolve));
      return {
        ...emptyReconciliation,
        revision: 1,
        changed: 1,
        upserts: [historicalEntry('historical', 'Worker reconciled history')],
      };
    },
    sessionFileSnapshot: async () => ({ revision: 1, changed: 0, entries: [] }),
  });
  const { persistence } = openPersistence(t, { searchClient });
  const operation = persistence.reconcileSessionFiles();
  assert.ok(operation instanceof Promise, 'raw reconciliation stays off the caller thread');
  assert.deepEqual(persistence.listHistoricalSessions({ workspaceCwds: ['/repo'] }), []);

  assert.equal(await operation, 1);
  assert.equal(reconciles, 1);
  assert.equal(
    persistence.listHistoricalSessions({ workspaceCwds: ['/repo'] })[0]?.summary.title,
    'Worker reconciled history',
  );
});

test('a reconciliation revision gap replaces the main cache from an authoritative snapshot', async (t) => {
  const oldEntry = historicalEntry('old', 'Old session');
  const newEntry = historicalEntry('new', 'Recovered session');
  let snapshotRequests = 0;
  const searchClient = stubSearchClient({
    reconcileSessionFiles: async () => ({
      ...emptyReconciliation,
      revision: 1,
      changed: 1,
      upserts: [oldEntry],
    }),
    reconcileSessionFilePaths: async () => ({
      ...emptyReconciliation,
      previousRevision: 2,
      revision: 3,
      changed: 1,
      upserts: [newEntry],
    }),
    sessionFileSnapshot: async () => {
      snapshotRequests += 1;
      return { revision: 3, changed: 0, entries: [newEntry] };
    },
  });
  const { persistence } = openPersistence(t, { searchClient });
  await persistence.reconcileSessionFiles();
  assert.equal(await persistence.reconcileSessionFilePaths([]), 1);
  assert.equal(snapshotRequests, 1);
  assert.deepEqual(
    persistence
      .listHistoricalSessions({ workspaceCwds: ['/repo'] })
      .map((item) => item.summary.title),
    ['Recovered session'],
  );
});

test('an active search cannot delay a persistence durability boundary', async (t) => {
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
  const { persistence } = openPersistence(t, { persistenceClient, searchClient });
  const search = persistence.searchSessions('needle');
  await new Promise<void>((resolve) => setImmediate(resolve));

  persistence.recordEvent(output('during-search'));
  await persistence.flush();

  assert.deepEqual(
    persisted.flatMap((batch) => batch.events.map((item) => item.id)),
    ['during-search'],
  );
  resolveSearch?.({ results: [], indexingIncomplete: false });
  await search;
});

test('live work pauses an idle history backfill, and idle samples cannot resume it while work is active', async (t) => {
  const idleStates: boolean[] = [];
  const searchClient = stubSearchClient({
    setIndexingIdle: async (isIdle) => {
      idleStates.push(isIdle);
    },
  });
  const { persistence } = openPersistence(t, { searchClient });
  await persistence.setIndexingIdle(true);
  persistence.recordEvent(output('live-event'));
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.deepEqual(idleStates, [true, false]);
  await persistence.flush();

  idleStates.length = 0;
  persistence.syncSummaries([summary()]);
  await persistence.setIndexingIdle(true);
  persistence.syncSummaries([summary({ streaming: false })]);
  persistence.upsertChildSession(child('running'));
  await persistence.setIndexingIdle(true);
  persistence.upsertChildSession(child('completed'));
  await persistence.setIndexingIdle(true);
  assert.deepEqual(idleStates, [false, false, true]);
});

test('a durability boundary does not wait for ordinary output to stop', async (t) => {
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
  // Release held barriers before the persistence closes, or close waits on them.
  t.after(() => {
    holdBarriers = false;
    for (const release of barriers) release();
  });
  const { persistence } = openPersistence(t, { persistenceClient });
  const nextBarrier = async (count: number) => {
    while (barriers.length < count) await new Promise<void>((resolve) => setImmediate(resolve));
    barriers[count - 1]?.();
  };
  persistence.recordEvent(output('before', 'another-chat'));
  const boundary = persistence.flush();
  persistence.recordEvent(output('during', 'another-chat'));
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
});

test('reconciliation drains pending commits without running a durability barrier', async (t) => {
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
  t.after(() => {
    allowBarrier = true;
    hotPathMetrics.reset();
  });
  const { persistence } = openPersistence(t, { persistenceClient });
  persistence.recordEvent(output('pending-before-reconcile'));

  await assert.doesNotReject(persistence.reconcileSessionFiles());
  assert.deepEqual(persisted, [['pending-before-reconcile']]);
  assert.equal(barriers, 0);
  assert.equal(hotPathMetrics.snapshot().histograms.persistenceBoundaryMs.count, 0);

  allowBarrier = true;
  await persistence.flush();
  assert.equal(barriers, 1);
  assert.equal(hotPathMetrics.snapshot().histograms.persistenceBoundaryMs.count, 1);
});

test('forgetSession removes live summary and child overlays', (t) => {
  const { persistence } = openPersistence(t, { persistenceClient: stubPersistenceClient() });
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
});

test('persistence reports degraded state once and reports recovery after retained work commits', async (t) => {
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
  const { persistence } = openPersistence(t, {
    persistenceClient,
    searchClient: stubSearchClient(),
    onStatusChanged: (status) => statuses.push(status.state),
  });
  persistence.recordEvent(output('one'));
  await assert.rejects(async () => await persistence.flush(), /worker exited/);
  assert.doesNotThrow(() => persistence.recordEvent(output('two')));
  await persistence.flush();

  assert.deepEqual(statuses, ['degraded', 'healthy']);
});

test('the search worker starts only when warmed or first searched, never for persistence', async (t) => {
  let searchWorkersCreated = 0;
  let searchCalls = 0;
  let reconcileCalls = 0;
  const searchClient = stubSearchClient();
  const { persistence } = openPersistence(t, {
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
  await persistence.flush();
  assert.equal(searchWorkersCreated, 0);

  persistence.warmSearchWorker();
  assert.equal(searchWorkersCreated, 1);
  assert.equal(searchCalls, 0);
  assert.equal(reconcileCalls, 0);

  await persistence.searchSessions('needle');
  assert.equal(searchWorkersCreated, 1);
  assert.equal(searchCalls, 1);
});
