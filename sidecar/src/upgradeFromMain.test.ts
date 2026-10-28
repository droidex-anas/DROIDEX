import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';

import { HistoryIndexDatabase } from './historyIndexDatabase.js';
import { initializeSessionFileCacheSchema } from './sessionFileCacheSchema.js';
import { persistTestSummaries } from './testing/historyPersistenceFixture.js';
import { providerSessionJsonl } from './testing/providerSessionFixtures.js';
import { sessionSummary } from './testing/sessionSummaryFixture.js';

const { HistoryIndex, SESSION_INDEX_FILENAME, SESSION_SEARCH_INDEX_FILENAME } =
  await import('./history.js');

const ORIGIN_MAIN_SESSION_FILE_CACHE = `
  CREATE TABLE session_file_cache (
    provider_session_id TEXT PRIMARY KEY,
    path TEXT NOT NULL,
    birthtime_ms REAL NOT NULL,
    mtime_ms REAL NOT NULL,
    size_bytes INTEGER NOT NULL,
    settings_mtime_ms REAL,
    summary_json TEXT
  )
`;

function withIsolatedHome(fn: (home: string) => void | Promise<void>): Promise<void> {
  const home = mkdtempSync(join(tmpdir(), 'droidex-upgrade-from-main-'));
  const previousHome = process.env.HOME;
  process.env.HOME = home;
  return Promise.resolve()
    .then(() => fn(home))
    .finally(() => {
      if (previousHome === undefined) delete process.env.HOME;
      else process.env.HOME = previousHome;
      rmSync(home, { recursive: true, force: true });
    });
}

function writeSessionFile(home: string, id: string, cwd: string): string {
  const dir = join(home, '.factory', 'sessions');
  mkdirSync(dir, { recursive: true });
  const path = join(dir, `${id}.jsonl`);
  writeFileSync(
    path,
    providerSessionJsonl({
      type: 'session_start',
      cwd,
      sessionTitle: `Chat ${id}`,
      settings: { interactionMode: 'auto' },
    }),
  );
  return path;
}

const SESSION_FILE_CACHE_COLUMNS = [
  'provider_session_id',
  'path',
  'birthtime_ms',
  'mtime_ms',
  'size_bytes',
  'settings_mtime_ms',
  'summary_json',
  'launch_settings_json',
];

test('an origin/main index with a leftover file cache opens, and the first derived index rebuilds the cache beside it', async () => {
  await withIsolatedHome((home) => {
    const workspace = join(home, 'workspace');
    writeSessionFile(home, 'kept-chat', workspace);
    const created = new HistoryIndex();
    const now = Date.now();
    persistTestSummaries([
      sessionSummary({
        appSessionId: 'kept-chat',
        title: 'Chat kept-chat',
        cwd: workspace,
        workspaceKind: 'folder',
        createdAt: now,
        updatedAt: now,
      }),
    ]);
    created.close();

    const canonicalPath = join(home, '.factory', 'droidex', SESSION_INDEX_FILENAME);
    const canonical = new DatabaseSync(canonicalPath);
    canonical.exec(ORIGIN_MAIN_SESSION_FILE_CACHE);
    canonical
      .prepare(
        `INSERT INTO session_file_cache (
          provider_session_id, path, birthtime_ms, mtime_ms, size_bytes, settings_mtime_ms, summary_json
        ) VALUES (?, ?, 1, 1, 1, NULL, NULL)`,
      )
      .run('stale-cache-row', join(home, '.factory', 'sessions', 'missing.jsonl'));
    canonical.close();

    const upgraded = new HistoryIndex();
    try {
      assert.equal(
        upgraded.sessionFileCacheSize,
        0,
        'the main-thread mirror does not read the leftover canonical cache',
      );
      const rows = upgraded.listHistoricalSessions({ workspaceCwds: [workspace] });
      assert.equal(
        rows.some((row) => row.summary.appSessionId === 'kept-chat'),
        false,
        'canonical records need an admitted provider-file summary before listing',
      );
    } finally {
      upgraded.close();
    }

    const derived = new HistoryIndexDatabase(canonicalPath);
    try {
      const result = derived.reconcileSessionFiles();
      const rebuilt = result.upserts.find((entry) => entry.providerSessionId === 'kept-chat');
      assert.equal(rebuilt?.summary?.appSessionId, 'kept-chat');
      assert.equal(rebuilt?.summary?.title, 'Chat kept-chat');
      const snapshot = derived.sessionFileSnapshot();
      assert.equal(
        snapshot.entries.some((entry) => entry.providerSessionId === 'kept-chat' && entry.summary),
        true,
      );
    } finally {
      derived.close();
    }

    const searchPath = join(home, '.factory', 'droidex', SESSION_SEARCH_INDEX_FILENAME);
    assert.deepEqual(columnNames(searchPath, 'session_file_cache'), SESSION_FILE_CACHE_COLUMNS);
    // Canonical history, and its leftover cache, are left as they were.
    const verified = new DatabaseSync(canonicalPath);
    const session = verified
      .prepare('SELECT app_session_id, cwd FROM app_sessions WHERE app_session_id = ?')
      .get('kept-chat') as { app_session_id: string; cwd: string } | undefined;
    const leftover = verified
      .prepare('SELECT provider_session_id FROM session_file_cache WHERE provider_session_id = ?')
      .get('stale-cache-row') as { provider_session_id: string } | undefined;
    verified.close();
    assert.equal(session?.app_session_id, 'kept-chat');
    assert.equal(session?.cwd, workspace);
    assert.equal(leftover?.provider_session_id, 'stale-cache-row');
    assert.equal(
      columnNames(canonicalPath, 'session_file_cache').includes('launch_settings_json'),
      false,
    );
  });
});

test('an origin/main-shaped derived cache is dropped and recreated', () => {
  const db = new DatabaseSync(':memory:');
  db.exec(ORIGIN_MAIN_SESSION_FILE_CACHE);
  db.exec(
    `INSERT INTO session_file_cache (
      provider_session_id, path, birthtime_ms, mtime_ms, size_bytes, settings_mtime_ms, summary_json
    ) VALUES ('old-row', '/tmp/old.jsonl', 1, 1, 1, NULL, '{"cacheVersion":1}')`,
  );
  initializeSessionFileCacheSchema(db);
  assert.deepEqual(columnNamesFrom(db, 'session_file_cache'), SESSION_FILE_CACHE_COLUMNS);
  const leftover = db.prepare('SELECT count(*) AS count FROM session_file_cache').get() as {
    count: number;
  };
  assert.equal(leftover.count, 0);
  db.close();
});

function columnNames(path: string, table: string): string[] {
  const db = new DatabaseSync(path);
  try {
    return columnNamesFrom(db, table);
  } finally {
    db.close();
  }
}

function columnNamesFrom(db: DatabaseSync, table: string): string[] {
  return db
    .prepare(`PRAGMA table_info(${table})`)
    .all()
    .map((row) => String((row as { name: unknown }).name));
}
