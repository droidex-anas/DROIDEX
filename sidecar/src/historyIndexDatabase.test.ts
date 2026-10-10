import assert from 'node:assert/strict';
import {
  appendFileSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  utimesSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import test, { type TestContext } from 'node:test';

import { HistoryIndexDatabase } from './historyIndexDatabase.js';
import { SESSION_SEARCH_INDEX_FILENAME } from './history.js';
import {
  HistorySearchUnavailableError,
  sqliteFts5UnavailableSkipReason,
} from './historySearchSchema.js';

const needsFts5 = { skip: sqliteFts5UnavailableSkipReason() };

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

/**
 * A HistoryIndexDatabase over an empty HOME whose sessions `seed` writes first,
 * with its slices held on a manual scheduler. Closed when the test ends.
 */
function indexDatabase(t: TestContext, seed: (sessionsDirectory: string, now: number) => void) {
  const home = mkdtempSync(join(tmpdir(), 'droidex-progressive-index-'));
  const previousHome = process.env.HOME;
  process.env.HOME = home;
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
  t.after(async () => {
    await database.close();
    process.env.HOME = previousHome;
    rmSync(home, { recursive: true, force: true });
  });
  return { database, slices, sessionsDirectory, clock, dbPath };
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
  needsFts5,
  async (t) => {
    const { database, slices } = indexDatabase(t, (sessionsDirectory, now) => {
      writeSession(sessionsDirectory, 'recent-provider', 'recent narwhal', now - DAY_MS);
      writeOldSession(sessionsDirectory, 'old-provider', 'old albatross', now);
    });
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

test('a corrupt history search database is set aside and rebuilt', async (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'droidex-derived-corruption-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const dbPath = join(directory, 'session-index.sqlite');
  const derivedPath = join(directory, SESSION_SEARCH_INDEX_FILENAME);
  createCanonicalDatabase(dbPath);
  writeFileSync(derivedPath, 'not a sqlite database');

  await new HistoryIndexDatabase(dbPath).close();
  const setAside = readdirSync(directory).filter((name) =>
    name.startsWith(`${SESSION_SEARCH_INDEX_FILENAME}.corrupt-`),
  );
  assert.equal(setAside.length, 1);
  assert.equal(readFileSync(join(directory, setAside[0]), 'utf8'), 'not a sqlite database');
  const canonical = new DatabaseSync(dbPath, { readOnly: true });
  try {
    assert.equal(
      canonical
        .prepare("SELECT count(*) AS count FROM sqlite_schema WHERE name = 'app_sessions'")
        .get()?.count,
      1,
    );
  } finally {
    canonical.close();
  }
});

test('search initialization corruption preserves an owned summary whose transcript is missing', async (t) => {
  let path = '';
  const { database, clock, dbPath } = indexDatabase(t, (directory, now) => {
    path = writeSession(directory, 'owned-provider', 'retained catalog summary', now);
  });
  const canonical = new DatabaseSync(dbPath);
  try {
    canonical.exec(`
      ALTER TABLE app_sessions ADD COLUMN session_purpose TEXT;
      ALTER TABLE app_sessions ADD COLUMN title TEXT;
      INSERT INTO app_sessions (app_session_id, provider_session_id, updated_at, session_purpose, title)
      VALUES ('owned-chat', 'owned-provider', ${clock.now}, 'chat', 'DROIDEX title');
    `);
  } finally {
    canonical.close();
  }
  database.reconcileSessionFiles();
  const retained = database.sessionFileSnapshot();
  assert.equal(retained.entries[0]?.summary?.title, 'owned-provider');
  rmSync(path);
  database.reconcileSessionFiles();
  assert.deepEqual(database.sessionFileSnapshot(), retained);
  await database.close();
  const persisted = JSON.parse(JSON.stringify(retained));

  const exec = DatabaseSync.prototype.exec;
  const corruption = t.mock.method(
    DatabaseSync.prototype,
    'exec',
    function (this: DatabaseSync, sql: string) {
      if (sql.includes('droidex_fts5_probe')) throw new Error('database disk image is malformed');
      return exec.call(this, sql);
    },
  );
  const degraded = new HistoryIndexDatabase(dbPath);
  try {
    const reconciliation = degraded.reconcileSessionFiles();
    assert.match(reconciliation.searchUnavailableReason ?? '', /Quit DROIDEX, back up/);
    assert.match(reconciliation.searchUnavailableReason ?? '', /repair the database or restore/);
    assert.deepEqual(degraded.sessionFileSnapshot(), persisted);
    assert.match(
      degraded.reconcileSessionFilePaths([{ providerSessionId: 'owned-provider', path }])
        .searchUnavailableReason ?? '',
      /corrupt/,
    );
    assert.deepEqual(degraded.sessionFileSnapshot(), persisted);
    assert.throws(
      () => degraded.search('retained'),
      (error: unknown) =>
        error instanceof HistorySearchUnavailableError &&
        /Quit DROIDEX, back up/.test(error.message),
    );
    degraded.setIdle(true);
    assert.equal(degraded.isIndexingIncomplete(), false);
  } finally {
    await degraded.close();
    corruption.mock.restore();
  }

  const restarted = new HistoryIndexDatabase(dbPath);
  try {
    restarted.reconcileSessionFiles();
    assert.deepEqual(restarted.sessionFileSnapshot(), persisted);
  } finally {
    await restarted.close();
  }
});

test('a corrupt search file keeps owned chats whose transcripts are missing', async (t) => {
  let path = '';
  const { database, clock, dbPath } = indexDatabase(t, (directory, now) => {
    path = writeSession(directory, 'owned-provider', 'retained catalog summary', now);
  });
  const canonical = new DatabaseSync(dbPath);
  try {
    canonical.exec(`
      ALTER TABLE app_sessions ADD COLUMN session_purpose TEXT;
      ALTER TABLE app_sessions ADD COLUMN title TEXT;
      INSERT INTO app_sessions (app_session_id, provider_session_id, updated_at, session_purpose, title)
      VALUES ('owned-chat', 'owned-provider', ${clock.now}, 'chat', 'DROIDEX title');
    `);
  } finally {
    canonical.close();
  }
  database.reconcileSessionFiles();
  rmSync(path);
  database.reconcileSessionFiles();
  const retained = JSON.parse(JSON.stringify(database.sessionFileSnapshot()));
  await database.close();

  let corruptOnce = true;
  const exec = DatabaseSync.prototype.exec;
  t.mock.method(DatabaseSync.prototype, 'exec', function (this: DatabaseSync, sql: string) {
    if (corruptOnce && sql === 'PRAGMA journal_mode = WAL') {
      corruptOnce = false;
      throw new Error('database disk image is malformed');
    }
    return exec.call(this, sql);
  });
  const rebuilt = new HistoryIndexDatabase(dbPath);
  try {
    rebuilt.reconcileSessionFiles();
    assert.deepEqual(
      rebuilt.sessionFileSnapshot().entries.map((entry) => entry.summary?.providerSessionId),
      retained.entries.map(
        (entry: { summary?: { providerSessionId?: string } }) => entry.summary?.providerSessionId,
      ),
    );
    assert.ok(
      readdirSync(dirname(dbPath)).some((name) =>
        name.startsWith(`${SESSION_SEARCH_INDEX_FILENAME}.corrupt-`),
      ),
    );
  } finally {
    await rebuilt.close();
  }
});

test('a transient file read failure stays queued for a later slice', needsFts5, async (t) => {
  let path = '';
  const { database, slices, clock } = indexDatabase(t, (sessionsDirectory, now) => {
    path = writeSession(sessionsDirectory, 'retry-provider', 'retry capybara', now);
  });
  const unavailablePath = `${path}.unavailable`;
  database.reconcileSessionFiles();
  renameSync(path, unavailablePath);
  await slices.runNext();
  await waitFor(() => slices.nextDelay() !== undefined);
  assert.equal(slices.nextDelay(), 1_000, 'the unreadable recent file backs off before retrying');

  renameSync(unavailablePath, path);
  clock.now += 1_000;
  await slices.runNext();
  assert.equal(await waitForSearch(database, 'retry capybara'), 'retry-provider');
});

test(
  'one unreadable provider does not delay a healthy provider in the same lane',
  needsFts5,
  async (t) => {
    let unreadablePath = '';
    const { database, slices } = indexDatabase(t, (sessionsDirectory, now) => {
      unreadablePath = writeSession(sessionsDirectory, 'a-unreadable', 'blocked kiwi', now);
      writeSession(sessionsDirectory, 'b-healthy', 'healthy kiwi', now - 1);
    });
    database.reconcileSessionFiles();
    renameSync(unreadablePath, `${unreadablePath}.unavailable`);
    await slices.runNext();
    await waitFor(() => slices.nextDelay() !== undefined);
    assert.equal(slices.nextDelay(), 2_000, 'the healthy recent provider keeps normal pacing');

    await slices.runNext();
    assert.equal(await waitForSearch(database, 'healthy kiwi'), 'b-healthy');
  },
);

test('a newly changed recent chat preempts a pending archive timer', needsFts5, (t) => {
  const { database, slices, sessionsDirectory, clock } = indexDatabase(
    t,
    (sessionsDirectory, now) => {
      writeOldSession(sessionsDirectory, 'priority-old', 'old priority', now);
    },
  );
  database.reconcileSessionFiles();
  database.setIdle(true);
  assert.equal(slices.nextDelay(), 5_000);

  const recentPath = writeSession(
    sessionsDirectory,
    'priority-recent',
    'recent priority',
    clock.now,
  );
  database.reconcileSessionFilePaths([{ providerSessionId: 'priority-recent', path: recentPath }]);
  assert.equal(slices.nextDelay(), 5_000);
});

test('an in-flight old slice cannot overwrite a newer watcher entry', needsFts5, async (t) => {
  let path = '';
  const { database, slices, clock } = indexDatabase(t, (sessionsDirectory, now) => {
    path = writeMultiSliceSession(sessionsDirectory, 'racing-provider', 'old searchable row', now);
  });
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
  assert.equal((await database.search('concurrent octopus'))[0]?.appSessionId, 'racing-provider');
});

test('a stable truncated tail parks until a watcher reports new bytes', needsFts5, async (t) => {
  let path = '';
  const { database, slices } = indexDatabase(t, (sessionsDirectory, now) => {
    path = writeSession(sessionsDirectory, 'truncated-provider', 'stable dolphin', now);
    appendFileSync(path, '{"id":"unfinished"');
  });
  database.reconcileSessionFiles();
  await slices.runNext();
  await slices.runNext();
  assert.equal(slices.nextDelay(), undefined, 'a zero-progress tail does not spin every 250ms');
  assert.equal((await database.search('stable dolphin'))[0]?.appSessionId, 'truncated-provider');

  appendFileSync(path, '}\n');
  database.reconcileSessionFilePaths([{ providerSessionId: 'truncated-provider', path }]);
  await waitFor(() => slices.nextDelay() !== undefined);
  assert.equal(
    slices.nextDelay(),
    2_000,
    'a real file change makes the parked tail eligible again',
  );
});

test(
  'a full reconcile cancels a deleted file in flight before stale rows commit',
  needsFts5,
  async (t) => {
    let path = '';
    const { database, slices } = indexDatabase(t, (sessionsDirectory, now) => {
      path = writeMultiSliceSession(
        sessionsDirectory,
        'deleted-provider',
        'deleted narwhal marker',
        now,
      );
    });
    database.reconcileSessionFiles();
    const activeSlice = slices.runNext();
    rmSync(path);
    database.reconcileSessionFiles();

    await activeSlice;
    await slices.drain();
    assert.deepEqual(await database.search('deleted narwhal'), []);
  },
);

test('indexing does not arm a slice timer when there is nothing to index', (t) => {
  const { database, slices } = indexDatabase(t, () => undefined);
  database.reconcileSessionFiles();
  assert.equal(slices.nextDelay(), undefined);
  assert.equal(database.isIndexingIncomplete(), false);
  database.setIdle(true);
  assert.equal(slices.nextDelay(), undefined);
  database.setIdle(false);
  assert.equal(slices.nextDelay(), undefined);
});
