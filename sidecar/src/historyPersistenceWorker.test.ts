import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import test, { type TestContext } from 'node:test';
import { Worker } from 'node:worker_threads';

import { HistoryPersistenceQueue } from './HistoryPersistenceQueue.js';
import { HistoryWorkerClient } from './HistoryWorkerClient.js';
import { HistoryPersistence } from './HistoryPersistence.js';
import { SESSION_INDEX_FILENAME, SESSION_SEARCH_INDEX_FILENAME } from './history.js';
import type { HistoryPersistenceBatch } from './historyPersistenceProtocol.js';
import type { SessionSummary } from './protocol.js';
import {
  HistorySearchUnavailableError,
  isHistorySearchUnavailableError,
  sqliteFts5UnavailableSkipReason,
} from './historySearchSchema.js';
import { providerSessionJsonl } from './testing/providerSessionFixtures.js';
import { sessionSummary } from './testing/sessionSummaryFixture.js';

const FTS5_UNAVAILABLE_REASON = sqliteFts5UnavailableSkipReason();

function createSchema(path: string): void {
  const db = new DatabaseSync(path);
  db.exec(`
    CREATE TABLE app_sessions (
      app_session_id TEXT PRIMARY KEY,
      provider_session_id TEXT NOT NULL,
      compacted_from_provider_session_ids TEXT NOT NULL DEFAULT '[]',
      session_purpose TEXT NOT NULL,
      interaction_mode TEXT NOT NULL,
      title TEXT NOT NULL,
      cwd TEXT,
      workspace_kind TEXT,
      updated_at INTEGER NOT NULL,
      model_id TEXT,
      reasoning_effort TEXT,
      fast_mode INTEGER,
      context_window_tokens INTEGER,
      compaction_model TEXT,
      worker_model_id TEXT,
      worker_reasoning_effort TEXT,
      validator_model_id TEXT,
      validator_reasoning_effort TEXT,
      autonomy TEXT,
      tokens_in INTEGER NOT NULL DEFAULT 0,
      tokens_out INTEGER NOT NULL DEFAULT 0,
      context_tokens INTEGER NOT NULL DEFAULT 0,
      context_remaining_tokens INTEGER,
      context_accuracy TEXT,
      context_updated_at TEXT,
      max_context_tokens INTEGER,
      auto_compactions INTEGER
    );
    CREATE TABLE child_sessions (
      parent_app_session_id TEXT NOT NULL,
      child_session_id TEXT NOT NULL,
      provider_session_id TEXT,
      previous_provider_session_ids TEXT NOT NULL DEFAULT '[]',
      role TEXT NOT NULL CHECK (role IN ('worker', 'validator')),
      label TEXT,
      prompt TEXT,
      group_name TEXT,
      phase TEXT,
      status TEXT NOT NULL CHECK (status IN ('pending', 'running', 'paused', 'completed', 'failed')),
      model_id TEXT NOT NULL,
      reasoning_effort TEXT,
      spawn_link_kind TEXT CHECK (spawn_link_kind IN ('tool-use', 'spawn')),
      spawn_link_id TEXT,
      transcript_available INTEGER NOT NULL CHECK (transcript_available IN (0, 1)),
      started_at INTEGER,
      settled_at INTEGER,
      updated_at INTEGER NOT NULL,
      PRIMARY KEY (parent_app_session_id, child_session_id)
    );
    CREATE TABLE events (
      id TEXT PRIMARY KEY,
      source_session_id TEXT NOT NULL,
      app_session_id TEXT,
      kind TEXT NOT NULL,
      ts INTEGER NOT NULL
    );
    CREATE TABLE settings (
      scope TEXT PRIMARY KEY,
      value_json TEXT NOT NULL,
      updated_at INTEGER NOT NULL
    );
  `);
  db.close();
}

function summary(): SessionSummary {
  return sessionSummary({
    providerSessionId: 'provider',
    title: 'Worker-backed persistence',
    cwd: '/repo',
    tokensIn: 10,
    tokensOut: 20,
    contextTokens: 30,
    updatedAt: 2,
  });
}

function eventBatch(id: string, ts: number): HistoryPersistenceBatch {
  return {
    events: [{ id, sourceSessionId: 'app', appSessionId: 'app', kind: 'text', ts }],
    summaries: [],
    children: [],
    estimatedBytes: 256,
  };
}

function summaryBatch(value = summary()): HistoryPersistenceBatch {
  return { events: [], summaries: [value], children: [], estimatedBytes: 1_024 };
}

function countEvents(dbPath: string): number {
  const db = new DatabaseSync(dbPath, { readOnly: true });
  try {
    return (db.prepare('SELECT COUNT(*) AS count FROM events').get() as { count: number }).count;
  } finally {
    db.close();
  }
}

/** A canonical schema in a scratch directory; workers pushed to `workers` are terminated after. */
function workerDatabase(t: TestContext) {
  const dir = mkdtempSync(join(tmpdir(), 'droidex-history-worker-'));
  const dbPath = join(dir, 'history.sqlite');
  const workers: Worker[] = [];
  t.after(async () => {
    await Promise.all(workers.map(async (worker) => await worker.terminate()));
    rmSync(dir, { recursive: true, force: true });
  });
  createSchema(dbPath);
  return { dir, dbPath, workers };
}

/** Collects unhandled rejections for the rest of the test. */
function watchUnhandledRejections(t: TestContext): unknown[] {
  const unhandled: unknown[] = [];
  const onUnhandled = (error: unknown) => unhandled.push(error);
  process.on('unhandledRejection', onUnhandled);
  t.after(() => process.removeListener('unhandledRejection', onUnhandled));
  return unhandled;
}

async function settleMicrotasks(): Promise<void> {
  await new Promise<void>((resolve) => setImmediate(resolve));
  await new Promise<void>((resolve) => setImmediate(resolve));
}

/** Points HOME at an empty directory for one test. */
function temporaryHome(t: TestContext, prefix: string): string {
  const home = mkdtempSync(join(tmpdir(), prefix));
  const previousHome = process.env.HOME;
  process.env.HOME = home;
  t.after(() => {
    process.env.HOME = previousHome;
    rmSync(home, { recursive: true, force: true });
  });
  return home;
}

test('worker persists a complete batch and awaits durability replies', async (t) => {
  const { dbPath } = workerDatabase(t);
  const client = new HistoryWorkerClient({ workerData: { dbPath, lane: 'persistence' } });
  t.after(() => client.close());
  const result = await client.startPersist({ ...eventBatch('event', 1), summaries: [summary()] })
    .promise;
  assert.equal(result.eventsWritten, 1);
  assert.equal(result.summariesWritten, 1);
  assert.ok((result.initializationMs ?? -1) >= 0);

  const db = new DatabaseSync(dbPath, { readOnly: true });
  const row = db
    .prepare('SELECT tokens_out FROM app_sessions WHERE app_session_id = ?')
    .get('app') as { tokens_out: number };
  db.close();
  assert.equal(row.tokens_out, 20);
  assert.equal(countEvents(dbPath), 1);
});

test('a locked derived search database cannot delay canonical durability', async (t) => {
  const { dir, dbPath } = workerDatabase(t);
  const derived = new DatabaseSync(join(dir, SESSION_SEARCH_INDEX_FILENAME));
  derived.exec('CREATE TABLE lock_holder (id INTEGER PRIMARY KEY); BEGIN IMMEDIATE');
  const client = new HistoryWorkerClient({
    workerData: { dbPath, lane: 'persistence' },
    transportTimeoutMs: 3_000,
  });
  t.after(async () => {
    derived.exec('ROLLBACK');
    derived.close();
    await client.close();
  });
  assert.equal((await client.startPersist(summaryBatch()).promise).summariesWritten, 1);
  assert.deepEqual(await client.startDurabilityBarrier().promise, { durable: true });
});

test('worker lanes reject requests from the other persistence contract', async (t) => {
  const { dbPath } = workerDatabase(t);
  const searchClient = new HistoryWorkerClient({ workerData: { dbPath, lane: 'search' } });
  t.after(() => searchClient.close());
  await assert.rejects(
    searchClient.startPersist({ events: [], summaries: [], children: [], estimatedBytes: 0 })
      .promise,
    /search worker cannot handle persist/,
  );
});

test(
  'index worker reconciles, searches, and removes provider files without candidate payloads',
  { skip: FTS5_UNAVAILABLE_REASON },
  async (t) => {
    const home = temporaryHome(t, 'droidex-history-index-worker-');
    const databaseDirectory = join(home, '.factory', 'droidex');
    const sessionsDirectory = join(home, '.factory', 'sessions', '2026', '08');
    mkdirSync(databaseDirectory, { recursive: true });
    mkdirSync(sessionsDirectory, { recursive: true });
    const dbPath = join(databaseDirectory, 'session-index.sqlite');
    const providerSessionId = 'indexed-provider';
    const sessionPath = join(sessionsDirectory, `${providerSessionId}.jsonl`);
    writeFileSync(
      sessionPath,
      providerSessionJsonl({
        type: 'session_start',
        cwd: '/repo',
        sessionTitle: 'Indexed worker session',
        settings: { interactionMode: 'auto' },
      }),
    );
    createSchema(dbPath);
    const client = new HistoryWorkerClient({ workerData: { dbPath, lane: 'search' } });
    t.after(() => client.close());

    const reconciliation = await client.reconcileSessionFiles();
    assert.equal(reconciliation.changed, 1);
    assert.equal(reconciliation.upserts[0]?.providerSessionId, providerSessionId);
    const firstSearch = await client.search('hello');
    assert.deepEqual(
      firstSearch.results,
      [],
      'search does not block on an uncommitted indexing slice',
    );
    assert.equal(firstSearch.indexingIncomplete, true);

    unlinkSync(sessionPath);
    const removal = await client.reconcileSessionFilePaths([
      { providerSessionId, path: sessionPath },
    ]);
    assert.deepEqual(removal.removedProviderSessionIds, [providerSessionId]);
    const afterRemoval = await client.search('hello');
    assert.deepEqual(afterRemoval.results, []);
    assert.equal(afterRemoval.indexingIncomplete, false);
  },
);

test('missing FTS5 degrades search without affecting canonical persistence', async (t) => {
  const home = temporaryHome(t, 'droidex-history-fts5-unavailable-');
  const databaseDirectory = join(home, '.factory', 'droidex');
  mkdirSync(databaseDirectory, { recursive: true });
  const dbPath = join(databaseDirectory, SESSION_INDEX_FILENAME);
  const unhandled = watchUnhandledRejections(t);
  const statuses: string[] = [];
  const searchClient = new HistoryWorkerClient({
    workerUrl: new URL(
      './testing/historyPersistenceWorkerFts5UnavailableLoader.mjs',
      import.meta.url,
    ),
    workerData: { dbPath, lane: 'search' },
  });
  const persistence = new HistoryPersistence({
    searchClient,
    onStatusChanged: (status) => statuses.push(status.state),
  });
  t.after(() => persistence.close());
  const record = (id: string, ts: number) => {
    persistence.recordEvent({
      id,
      appSessionId: 'app',
      sourceSessionId: 'app',
      role: 'primary',
      ts,
      kind: 'text',
      text: id,
    });
  };

  record('durable-event', 1);
  await persistence.flush();
  assert.equal(countEvents(dbPath), 1);

  assert.equal(await persistence.reconcileSessionFiles(), 0);
  assert.deepEqual(statuses, ['search_unavailable']);
  assert.match(persistence.persistenceRecovery().searchUnavailableReason ?? '', /FTS5/);

  await assert.rejects(persistence.searchSessions('needle'), (error: unknown) =>
    isHistorySearchUnavailableError(error),
  );
  await assert.rejects(
    persistence.searchSessions('needle'),
    (error: unknown) => error instanceof HistorySearchUnavailableError,
  );
  assert.equal(await persistence.reconcileSessionFiles(), 0);

  record('after-search', 2);
  await persistence.flush();
  assert.equal(countEvents(dbPath), 2);

  assert.deepEqual(statuses, ['search_unavailable']);
  await settleMicrotasks();
  assert.deepEqual(unhandled, []);
});

test('a close timeout does not leak an unhandled promise rejection', async (t) => {
  const { dbPath, workers } = workerDatabase(t);
  const unhandled = watchUnhandledRejections(t);
  const client = new HistoryWorkerClient({
    transportTimeoutMs: 0,
    workerFactory: persistenceWorkerFactory(dbPath, workers),
  });
  await assert.rejects(async () => await client.close(), /did not respond within 0ms/);
  await settleMicrotasks();
  assert.deepEqual(unhandled, []);
});

test('the worker client recreates a failed worker before the next persistence attempt', async (t) => {
  const { dbPath, workers } = workerDatabase(t);
  const client = new HistoryWorkerClient({
    workerFactory: persistenceWorkerFactory(dbPath, workers),
  });
  await client.startPersist(summaryBatch()).promise;
  await workers[0]?.terminate();

  assert.equal(
    (await client.startPersist(eventBatch('after-restart', 2)).promise).eventsWritten,
    1,
  );
  assert.equal(workers.length, 2);
  await client.close();
  assert.equal(countEvents(dbPath), 1);
});

test('a persistence timeout fails every outstanding call and recreates the worker without a caller waiting', async (t) => {
  const { dbPath, workers } = workerDatabase(t);
  const watchdogs = createWatchdogScheduler();
  const hungWorker = new Worker('setInterval(() => undefined, 1_000);', { eval: true });
  workers.push(hungWorker);
  const client = new HistoryWorkerClient({
    worker: hungWorker,
    workerFactory: persistenceWorkerFactory(dbPath, workers),
    scheduleWatchdog: watchdogs.schedule,
    cancelWatchdog: watchdogs.cancel,
  });
  const batch = eventBatch('after-async-timeout', 4);

  const first = client.startPersist(batch).promise;
  const second = client.startPersist(batch).promise;
  void first.catch(() => undefined);
  void second.catch(() => undefined);
  watchdogs.fireNext();
  await assert.rejects(settleWithin(first, 2_000), /did not respond within 10000ms/);
  await assert.rejects(settleWithin(second, 2_000), /did not respond within 10000ms/);
  assert.equal((await settleWithin(client.startPersist(batch).promise, 2_000)).eventsWritten, 1);
  assert.equal(workers.length, 2);
  assert.equal(watchdogs.pendingCount(), 0);
  await client.close();
});

test('a search transport timeout fails only that call', async (t) => {
  const watchdogs = createWatchdogScheduler();
  const worker = new Worker(
    `
      const { parentPort } = require('node:worker_threads');
      parentPort.on('message', ({ request, replyPort }) => {
        if (request.type === 'search') return;
        replyPort.postMessage({ ok: true, value: { accepted: true } });
        replyPort.close();
      });
    `,
    { eval: true },
  );
  t.after(() => worker.terminate());
  const client = new HistoryWorkerClient({
    worker,
    scheduleWatchdog: watchdogs.schedule,
    cancelWatchdog: watchdogs.cancel,
  });

  const search = client.search('needle');
  void search.catch(() => undefined);
  watchdogs.fireNext();
  await assert.rejects(settleWithin(search, 2_000), /did not respond within 60000ms/);
  await assert.doesNotReject(() => settleWithin(client.setIndexingIdle(true), 2_000));
  assert.equal(watchdogs.pendingCount(), 0);
  await client.close();
});

test('an asynchronous worker timeout lets the queue retry without a caller waiting', async (t) => {
  const { dbPath, workers } = workerDatabase(t);
  const scheduledCallbacks: Array<() => void> = [];
  const watchdogs = createWatchdogScheduler();
  let notifyFailure: (() => void) | undefined;
  let notifyCommit: (() => void) | undefined;
  const failed = new Promise<void>((resolve) => {
    notifyFailure = resolve;
  });
  const committed = new Promise<void>((resolve) => {
    notifyCommit = resolve;
  });
  const hungWorker = new Worker('setInterval(() => undefined, 1_000);', { eval: true });
  workers.push(hungWorker);
  const client = new HistoryWorkerClient({
    worker: hungWorker,
    workerFactory: persistenceWorkerFactory(dbPath, workers),
    scheduleWatchdog: watchdogs.schedule,
    cancelWatchdog: watchdogs.cancel,
  });
  const queue = new HistoryPersistenceQueue({
    dbPath,
    client,
    schedule: (callback) => {
      scheduledCallbacks.push(callback);
      return dormantTimer();
    },
    onFailure: () => notifyFailure?.(),
    onCommitted: () => notifyCommit?.(),
  });

  queue.enqueueEvent({
    id: 'queued-after-timeout',
    appSessionId: 'app',
    sourceSessionId: 'app',
    role: 'primary',
    ts: 5,
    kind: 'text',
    text: 'queued asynchronously',
  });
  const initialFlush = scheduledCallbacks.shift();
  assert.ok(initialFlush);
  initialFlush();
  watchdogs.fireNext();
  await settleWithin(failed, 2_000);
  const retry = scheduledCallbacks.shift();
  assert.ok(retry);
  retry();
  await settleWithin(committed, 2_000);

  assert.equal(queue.snapshot().pendingEntries, 0);
  assert.equal(queue.snapshot().inFlightEntries, 0);
  assert.equal(queue.snapshot().retries, 1);
  assert.equal(workers.length, 2);
  assert.equal(watchdogs.pendingCount(), 0);
  assert.equal(countEvents(dbPath), 1);
  await client.close();
});

test('a serialized persistence error does not restart the worker', async (t) => {
  const { dbPath, workers } = workerDatabase(t);
  const client = new HistoryWorkerClient({
    workerFactory: persistenceWorkerFactory(dbPath, workers),
  });
  const invalidSummary = summary();
  Object.defineProperty(invalidSummary, 'title', { value: undefined });

  await assert.rejects(
    async () => await client.startPersist(summaryBatch(invalidSummary)).promise,
    /cannot be bound/,
  );
  assert.equal(
    (await client.startPersist(eventBatch('after-operation-error', 6)).promise).eventsWritten,
    1,
  );
  assert.equal(workers.length, 1);
  await client.close();
});

test('a postMessage failure does not leak an unhandled rejection', async (t) => {
  const unhandled = watchUnhandledRejections(t);
  const worker = new Worker('setInterval(() => undefined, 1_000);', { eval: true });
  t.after(() => worker.terminate());
  Object.defineProperty(worker, 'postMessage', {
    value: () => {
      throw new Error('Worker postMessage failed.');
    },
  });
  const client = new HistoryWorkerClient({ worker });

  assert.throws(
    () => client.startPersist({ events: [], summaries: [], children: [], estimatedBytes: 0 }),
    /Worker postMessage failed/,
  );
  await settleMicrotasks();
  assert.deepEqual(unhandled, []);
  await client.close();
});

function persistenceWorkerFactory(dbPath: string, workers: Worker[]): () => Worker {
  return () => {
    const worker = new Worker(new URL('./historyPersistenceWorkerLoader.mjs', import.meta.url), {
      workerData: { dbPath, lane: 'persistence' },
      execArgv: [],
    });
    workers.push(worker);
    return worker;
  };
}

function settleWithin<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<T>((_resolve, reject) => {
    timer = setTimeout(
      () => reject(new Error(`Test timed out after ${String(timeoutMs)}ms.`)),
      timeoutMs,
    );
  });
  return Promise.race([promise, deadline]).finally(() => {
    if (timer) clearTimeout(timer);
  });
}

function dormantTimer(): ReturnType<typeof setTimeout> {
  const timer = setTimeout(() => undefined, 60_000);
  timer.unref();
  return timer;
}

function createWatchdogScheduler(): {
  schedule: (callback: () => void, timeoutMs: number) => ReturnType<typeof setTimeout>;
  cancel: (timer: ReturnType<typeof setTimeout>) => void;
  fireNext(): void;
  pendingCount(): number;
} {
  const callbacks = new Map<ReturnType<typeof setTimeout>, () => void>();
  return {
    schedule: (callback) => {
      const timer = dormantTimer();
      callbacks.set(timer, callback);
      return timer;
    },
    cancel: (timer) => {
      clearTimeout(timer);
      callbacks.delete(timer);
    },
    fireNext: () => {
      for (const callback of callbacks.values()) {
        callback();
        return;
      }
      throw new Error('Expected a transport watchdog.');
    },
    pendingCount: () => callbacks.size,
  };
}
