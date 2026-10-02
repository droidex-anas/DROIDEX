import assert from 'node:assert/strict';
import {
  appendFileSync,
  mkdirSync,
  mkdtempSync,
  renameSync,
  rmSync,
  utimesSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';

import { HistoryIndexDatabase } from './historyIndexDatabase.js';
import { SESSION_SEARCH_INDEX_FILENAME } from './history.js';
import { sqliteFts5UnavailableSkipReason, sqliteSupportsFts5 } from './historySearchSchema.js';

const FTS5_UNAVAILABLE_REASON = sqliteFts5UnavailableSkipReason();

const DAY_MS = 24 * 60 * 60 * 1_000;

interface ScheduledSlice {
  callback: () => void | Promise<void>;
  delayMs: number;
  timer: ReturnType<typeof setTimeout>;
  cancelled: boolean;
}

function scheduler(): {
  scheduled: ScheduledSlice[];
  schedule: (
    callback: () => void | Promise<void>,
    delayMs: number,
  ) => ReturnType<typeof setTimeout>;
  cancel: (timer: ReturnType<typeof setTimeout>) => void;
  runNext: () => Promise<void>;
  drain: () => Promise<void>;
  nextDelay: () => number | undefined;
} {
  const scheduled: ScheduledSlice[] = [];
  const api = {
    scheduled,
    schedule: (callback: () => void | Promise<void>, delayMs: number) => {
      const timer = setTimeout(() => undefined, 60_000);
      timer.unref();
      scheduled.push({ callback, delayMs, timer, cancelled: false });
      return timer;
    },
    cancel: (timer: ReturnType<typeof setTimeout>) => {
      const pending = scheduled.find((entry) => entry.timer === timer);
      if (pending) pending.cancelled = true;
      clearTimeout(timer);
    },
    runNext: async () => {
      const index = scheduled.findIndex((entry) => !entry.cancelled);
      assert.notEqual(index, -1, 'an indexing slice is scheduled');
      const [entry] = scheduled.splice(index, 1);
      await entry?.callback();
    },
    drain: async () => {
      while (api.nextDelay() !== undefined) await api.runNext();
    },
    nextDelay: () => scheduled.find((entry) => !entry.cancelled)?.delayMs,
  };
  return api;
}

async function waitFor(predicate: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (predicate()) return;
    await new Promise<void>((resolve) => setImmediate(resolve));
  }
  assert.fail('condition was not reached');
}

async function waitForSearch(
  database: HistoryIndexDatabase,
  query: string,
): Promise<string | undefined> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const appSessionId = (await database.search(query))[0]?.appSessionId;
    if (appSessionId) return appSessionId;
    await new Promise<void>((resolve) => setImmediate(resolve));
  }
  return undefined;
}

function createCanonicalDatabase(path: string): void {
  const db = new DatabaseSync(path);
  db.exec(`
    CREATE TABLE app_sessions (
      app_session_id TEXT PRIMARY KEY,
      provider_session_id TEXT NOT NULL,
      compacted_from_provider_session_ids TEXT NOT NULL DEFAULT '[]',
      updated_at INTEGER NOT NULL
    );
    CREATE TABLE settings (
      scope TEXT PRIMARY KEY,
      value_json TEXT NOT NULL,
      updated_at INTEGER NOT NULL
    )
  `);
  db.close();
}

interface IndexFixture {
  database: HistoryIndexDatabase;
  slices: ReturnType<typeof scheduler>;
  sessionsDirectory: string;
  clock: { now: number };
}

async function withIndexDatabase(
  seed: (sessionsDirectory: string, now: number) => void,
  run: (fixture: IndexFixture) => Promise<void>,
): Promise<void> {
  const home = mkdtempSync(join(tmpdir(), 'droidex-progressive-index-'));
  const previousHome = process.env['HOME'];
  process.env['HOME'] = home;
  const databaseDirectory = join(home, '.factory', 'droidex');
  const sessionsDirectory = join(home, '.factory', 'sessions');
  mkdirSync(databaseDirectory, { recursive: true });
  mkdirSync(sessionsDirectory, { recursive: true });
  const dbPath = join(databaseDirectory, 'session-index.sqlite');
  createCanonicalDatabase(dbPath);
  const clock = { now: Date.UTC(2026, 7, 24) };
  seed(sessionsDirectory, clock.now);
  const slices = scheduler();
  const database = new HistoryIndexDatabase(dbPath, {
    now: () => clock.now,
    schedule: slices.schedule,
    cancel: slices.cancel,
  });
  try {
    await run({ database, slices, sessionsDirectory, clock });
  } finally {
    await database.close();
    if (previousHome === undefined) delete process.env['HOME'];
    else process.env['HOME'] = previousHome;
    rmSync(home, { recursive: true, force: true });
  }
}

function writeOldSession(
  sessionsDirectory: string,
  providerSessionId: string,
  text: string,
  now: number,
): void {
  const path = writeSession(sessionsDirectory, providerSessionId, text, now - 30 * DAY_MS);
  const oldDate = new Date(now - 30 * DAY_MS);
  utimesSync(path, oldDate, oldDate);
}

/** A transcript large enough that indexing it takes more than one slice. */
function writeMultiSliceSession(
  sessionsDirectory: string,
  providerSessionId: string,
  text: string,
  now: number,
): string {
  const lines: string[] = [
    JSON.stringify({
      type: 'session_start',
      cwd: '/repo',
      sessionTitle: providerSessionId,
      settings: { interactionMode: 'auto' },
    }),
  ];
  for (let index = 0; index < 2_000; index += 1) {
    lines.push(
      JSON.stringify({
        id: `${providerSessionId}-${String(index)}`,
        type: 'message',
        timestamp: new Date(now + index).toISOString(),
        message: {
          role: index % 2 === 0 ? 'user' : 'assistant',
          content: [{ type: 'text', text: `${text} ${String(index)} ${'x'.repeat(120)}` }],
        },
      }),
    );
  }
  const path = join(sessionsDirectory, `${providerSessionId}.jsonl`);
  writeFileSync(path, `${lines.join('\n')}\n`);
  return path;
}

function writeSession(
  sessionsDirectory: string,
  providerSessionId: string,
  text: string,
  timestamp: number,
): string {
  const lines = [
    {
      type: 'session_start',
      cwd: '/repo',
      sessionTitle: providerSessionId,
      settings: { interactionMode: 'auto' },
    },
    {
      id: `${providerSessionId}-user`,
      type: 'message',
      timestamp: new Date(timestamp).toISOString(),
      message: { role: 'user', content: [{ type: 'text', text }] },
    },
    {
      id: `${providerSessionId}-assistant`,
      type: 'message',
      timestamp: new Date(timestamp + 1).toISOString(),
      message: { role: 'assistant', content: [{ type: 'text', text: 'answer' }] },
    },
  ];
  const path = join(sessionsDirectory, `${providerSessionId}.jsonl`);
  writeFileSync(path, `${lines.map((line) => JSON.stringify(line)).join('\n')}\n`);
  return path;
}

test(
  'recent histories index first at the active pace while old histories wait for idle slices',
  { skip: FTS5_UNAVAILABLE_REASON },
  async () => {
    await withIndexDatabase(
      (sessionsDirectory, now) => {
        writeSession(sessionsDirectory, 'recent-provider', 'recent narwhal', now - DAY_MS);
        writeOldSession(sessionsDirectory, 'old-provider', 'old albatross', now);
      },
      async ({ database, slices }) => {
        const reconciliation = database.reconcileSessionFiles();
        assert.equal(reconciliation.upserts.length, 2);
        assert.equal(slices.nextDelay(), 2_000, 'recent history is paced while the user is active');
        database.setIdle(true);
        assert.equal(slices.nextDelay(), 5_000, 'an idle desktop slows recent slices');
        database.setIdle(false);
        assert.equal(slices.nextDelay(), 2_000, 'activity restores the interactive delay');
        assert.equal(database.isIndexingIncomplete(), true);
        assert.deepEqual(await database.search('old albatross'), []);
        assert.deepEqual(
          await database.search('recent narwhal'),
          [],
          'interactive search returns the committed index without doing file work',
        );

        await slices.runNext();
        assert.equal(await waitForSearch(database, 'recent narwhal'), 'recent-provider');
        assert.equal(database.isIndexingIncomplete(), true, 'older history is still unindexed');
        assert.equal(slices.nextDelay(), undefined, 'archive backfill stays unarmed while active');

        database.setIdle(true);
        assert.equal(slices.nextDelay(), 5_000, 'old history uses the slower idle-only pace');
        database.setIdle(false);
        assert.equal(slices.nextDelay(), undefined);
        database.setIdle(true);
        await slices.runNext();
        assert.equal((await database.search('old albatross'))[0]?.appSessionId, 'old-provider');
        assert.equal(database.isIndexingIncomplete(), false);
      },
    );
  },
);

test('a corrupt derived database is deleted and rebuilt without touching canonical history', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'droidex-derived-corruption-'));
  const dbPath = join(directory, 'session-index.sqlite');
  const derivedPath = join(directory, SESSION_SEARCH_INDEX_FILENAME);
  createCanonicalDatabase(dbPath);
  writeFileSync(derivedPath, 'not a sqlite database');

  const database = new HistoryIndexDatabase(dbPath);
  try {
    assert.deepEqual(database.sessionFileSnapshot(), { revision: 0, changed: 0, entries: [] });
  } finally {
    await database.close();
  }

  const canonical = new DatabaseSync(dbPath, { readOnly: true });
  const derived = new DatabaseSync(derivedPath, { readOnly: true });
  try {
    assert.equal(
      canonical
        .prepare("SELECT count(*) AS count FROM sqlite_schema WHERE name = 'app_sessions'")
        .get()?.['count'],
      1,
    );
    assert.equal(
      derived
        .prepare("SELECT count(*) AS count FROM sqlite_schema WHERE name = 'session_file_cache'")
        .get()?.['count'],
      1,
    );
    assert.equal(
      derived
        .prepare("SELECT count(*) AS count FROM sqlite_schema WHERE name = 'history_search_fts'")
        .get()?.['count'],
      sqliteSupportsFts5() ? 1 : 0,
    );
  } finally {
    derived.close();
    canonical.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test(
  'a transient file read failure stays queued for a later slice',
  { skip: FTS5_UNAVAILABLE_REASON },
  async () => {
    let path = '';
    await withIndexDatabase(
      (sessionsDirectory, now) => {
        path = writeSession(sessionsDirectory, 'retry-provider', 'retry capybara', now);
      },
      async ({ database, slices, clock }) => {
        const unavailablePath = `${path}.unavailable`;
        database.reconcileSessionFiles();
        renameSync(path, unavailablePath);
        await slices.runNext();
        await waitFor(() => slices.nextDelay() !== undefined);
        assert.equal(
          slices.nextDelay(),
          1_000,
          'the unreadable recent file backs off before retrying',
        );

        renameSync(unavailablePath, path);
        clock.now += 1_000;
        await slices.runNext();
        assert.equal(await waitForSearch(database, 'retry capybara'), 'retry-provider');
      },
    );
  },
);

test(
  'one unreadable provider does not delay a healthy provider in the same lane',
  { skip: FTS5_UNAVAILABLE_REASON },
  async () => {
    let unreadablePath = '';
    await withIndexDatabase(
      (sessionsDirectory, now) => {
        unreadablePath = writeSession(sessionsDirectory, 'a-unreadable', 'blocked kiwi', now);
        writeSession(sessionsDirectory, 'b-healthy', 'healthy kiwi', now - 1);
      },
      async ({ database, slices }) => {
        database.reconcileSessionFiles();
        renameSync(unreadablePath, `${unreadablePath}.unavailable`);
        await slices.runNext();
        await waitFor(() => slices.nextDelay() !== undefined);
        assert.equal(slices.nextDelay(), 2_000, 'the healthy recent provider keeps normal pacing');

        await slices.runNext();
        assert.equal(await waitForSearch(database, 'healthy kiwi'), 'b-healthy');
      },
    );
  },
);

test(
  'a newly changed recent chat preempts a pending archive timer',
  { skip: FTS5_UNAVAILABLE_REASON },
  async () => {
    await withIndexDatabase(
      (sessionsDirectory, now) => {
        writeOldSession(sessionsDirectory, 'priority-old', 'old priority', now);
      },
      async ({ database, slices, sessionsDirectory, clock }) => {
        database.reconcileSessionFiles();
        database.setIdle(true);
        assert.equal(slices.nextDelay(), 5_000);

        const recentPath = writeSession(
          sessionsDirectory,
          'priority-recent',
          'recent priority',
          clock.now,
        );
        database.reconcileSessionFilePaths([
          { providerSessionId: 'priority-recent', path: recentPath },
        ]);
        assert.equal(slices.nextDelay(), 5_000);
      },
    );
  },
);

test(
  'an in-flight old slice cannot overwrite a newer watcher entry',
  { skip: FTS5_UNAVAILABLE_REASON },
  async () => {
    let path = '';
    await withIndexDatabase(
      (sessionsDirectory, now) => {
        path = writeMultiSliceSession(
          sessionsDirectory,
          'racing-provider',
          'old searchable row',
          now,
        );
      },
      async ({ database, slices, clock }) => {
        database.reconcileSessionFiles();
        const activeSlice = slices.runNext();

        appendFileSync(
          path,
          `${JSON.stringify({
            id: 'new-concurrent-row',
            type: 'message',
            timestamp: new Date(clock.now + 3_000).toISOString(),
            message: {
              role: 'assistant',
              content: [{ type: 'text', text: 'concurrent octopus marker' }],
            },
          })}\n`,
        );
        database.reconcileSessionFilePaths([{ providerSessionId: 'racing-provider', path }]);

        await activeSlice;
        await slices.drain();
        assert.equal(
          (await database.search('concurrent octopus'))[0]?.appSessionId,
          'racing-provider',
        );
      },
    );
  },
);

test(
  'a stable truncated tail parks until a watcher reports new bytes',
  { skip: FTS5_UNAVAILABLE_REASON },
  async () => {
    let path = '';
    await withIndexDatabase(
      (sessionsDirectory, now) => {
        path = writeSession(sessionsDirectory, 'truncated-provider', 'stable dolphin', now);
        appendFileSync(path, '{"id":"unfinished"');
      },
      async ({ database, slices }) => {
        database.reconcileSessionFiles();
        await slices.runNext();
        await slices.runNext();
        assert.equal(
          slices.nextDelay(),
          undefined,
          'a zero-progress tail does not spin every 250ms',
        );
        assert.equal(
          (await database.search('stable dolphin'))[0]?.appSessionId,
          'truncated-provider',
        );

        appendFileSync(path, '}\n');
        database.reconcileSessionFilePaths([{ providerSessionId: 'truncated-provider', path }]);
        await waitFor(() => slices.nextDelay() !== undefined);
        assert.equal(
          slices.nextDelay(),
          2_000,
          'a real file change makes the parked tail eligible again',
        );
      },
    );
  },
);

test(
  'a full reconcile cancels a deleted file in flight before stale rows commit',
  { skip: FTS5_UNAVAILABLE_REASON },
  async () => {
    let path = '';
    await withIndexDatabase(
      (sessionsDirectory, now) => {
        path = writeMultiSliceSession(
          sessionsDirectory,
          'deleted-provider',
          'deleted narwhal marker',
          now,
        );
      },
      async ({ database, slices }) => {
        database.reconcileSessionFiles();
        const activeSlice = slices.runNext();
        rmSync(path);
        database.reconcileSessionFiles();

        await activeSlice;
        await slices.drain();
        assert.deepEqual(await database.search('deleted narwhal'), []);
      },
    );
  },
);

test('indexing does not arm a slice timer when there is nothing to index', async () => {
  await withIndexDatabase(
    () => undefined,
    async ({ database, slices }) => {
      database.reconcileSessionFiles();
      assert.equal(slices.nextDelay(), undefined);
      assert.equal(database.isIndexingIncomplete(), false);
      database.setIdle(true);
      assert.equal(slices.nextDelay(), undefined);
      database.setIdle(false);
      assert.equal(slices.nextDelay(), undefined);
    },
  );
});
