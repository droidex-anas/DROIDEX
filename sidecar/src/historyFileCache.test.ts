import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  statSync,
  unlinkSync,
  utimesSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type { HistoryIndex as HistoryIndexType } from './history.js';
import type * as Protocol from './protocol.js';
import {
  SessionFileCache,
  type SessionFileChange,
  type SessionFileStat,
  type SessionFileSummary,
} from './sessionFileCache.js';
import { SessionManager } from './SessionManager.js';
import {
  providerSessionJsonl,
  type ProviderMessageRole,
} from './testing/providerSessionFixtures.js';
import { persistTestEvent, persistTestSummaries } from './testing/historyPersistenceFixture.js';
import { sessionSummary } from './testing/sessionSummaryFixture.js';
import { appendSessionNotice, readSessionNotices } from './sessionNotices.js';
import { HistoryIndexDatabase } from './historyIndexDatabase.js';

const originalHome = process.env.HOME;
const home = mkdtempSync(join(tmpdir(), 'droid-history-cache-home-'));
process.env.HOME = home;

const {
  HistoryIndex,
  createHistorySessionFileCache,
  SESSION_INDEX_FILENAME,
  SESSION_SEARCH_INDEX_FILENAME,
} = await import('./history.js');

test.after(() => {
  if (originalHome === undefined) delete process.env.HOME;
  else process.env.HOME = originalHome;
  rmSync(home, { recursive: true, force: true });
});

/** Points HOME at an empty directory for one test. */
function freshHome(t: TestContext, prefix: string): string {
  const fresh = mkdtempSync(join(tmpdir(), prefix));
  const previous = process.env.HOME;
  process.env.HOME = fresh;
  t.after(() => {
    process.env.HOME = previous;
    rmSync(fresh, { recursive: true, force: true });
  });
  return fresh;
}

function writeSession(
  root: string,
  id: string,
  cwd: string,
  extra: Record<string, unknown> = {},
  messageRoles: ProviderMessageRole[] = ['user', 'assistant'],
): string {
  const dir = join(root, '.factory', 'sessions');
  mkdirSync(dir, { recursive: true });
  const path = join(dir, `${id}.jsonl`);
  writeFileSync(
    path,
    providerSessionJsonl(
      {
        type: 'session_start',
        cwd,
        sessionTitle: `Chat ${id}`,
        settings: { interactionMode: 'auto' },
        ...extra,
      },
      messageRoles,
    ),
  );
  return path;
}

function writeEmptySession(root: string, id: string, cwd: string): string {
  return writeSession(root, id, cwd, { sessionTitle: 'New Session' }, []);
}

function patchFor(appSessionId: string, cwd: string): Protocol.SessionSummary {
  const now = Date.now();
  return sessionSummary({
    appSessionId,
    title: `Chat ${appSessionId}`,
    goal: `Chat ${appSessionId}`,
    cwd,
    workspaceKind: cwd ? 'folder' : 'none',
    streaming: false,
    queuedSends: 0,
    createdAt: now,
    updatedAt: now,
  });
}

function summaryFor(appSessionId: string, cwd: string): SessionFileSummary {
  return { summary: patchFor(appSessionId, cwd) };
}

function fileStat(path: string, mtimeMs = 1): SessionFileStat {
  return { path, birthtimeMs: 1, mtimeMs, sizeBytes: 10 + mtimeMs, settingsMtimeMs: null };
}

function searchIndexPath(): string {
  return join(process.env.HOME ?? '', '.factory', 'droidex', SESSION_SEARCH_INDEX_FILENAME);
}

/** Runs the worker's reconcile, of every file or of the reported ones, into `index`. */
function reconcile(
  index: HistoryIndexType,
  changes?: Array<{ providerSessionId: string; path: string }>,
): number {
  const db = new DatabaseSync(searchIndexPath());
  const canonical = new DatabaseSync(
    join(process.env.HOME ?? '', '.factory', 'droidex', SESSION_INDEX_FILENAME),
    { readOnly: true },
  );
  try {
    const cache = createHistorySessionFileCache(db, canonical);
    const result = changes ? cache.reconcilePathChanges(changes) : cache.reconcileChanges();
    if (!index.applySessionFileReconciliation(result)) {
      index.replaceSessionFileSnapshot(cache.snapshot(result.changed));
    }
    return result.changed;
  } finally {
    canonical.close();
    db.close();
  }
}

function setCachedSummaryJson(providerSessionId: string, json: string): void {
  const db = new DatabaseSync(searchIndexPath());
  try {
    db.prepare('UPDATE session_file_cache SET summary_json = ? WHERE provider_session_id = ?').run(
      json,
      providerSessionId,
    );
  } finally {
    db.close();
  }
}

test('reconcile hides Task children, preserves forks, and a second boot reconciles nothing', () => {
  writeSession(home, 'cache-plain', '');
  const workspace = join(home, 'workspace-a');
  writeSession(home, 'cache-workspace', workspace);
  writeSession(home, 'cache-child', workspace, {
    callingSessionId: 'cache-workspace',
    callingToolUseId: 'tool-1',
  });
  writeSession(home, 'worker-old', workspace, {
    callingSessionId: 'cache-workspace',
    callingToolUseId: 'tool-r',
  });
  writeSession(home, 'worker-new', workspace, {
    callingSessionId: 'cache-workspace',
    callingToolUseId: 'tool-r',
  });
  writeSession(home, 'forked-session', workspace, { parent: 'cache-workspace' });
  writeSession(home, 'fork-task-child', workspace, {
    parent: 'forked-session',
    callingSessionId: 'forked-session',
    callingToolUseId: 'tool-9',
  });

  const index = new HistoryIndex();
  try {
    assert.equal(reconcile(index), 7);
    // The Task child is cached as a known non-top-level file, not re-read later.
    assert.equal(index.sessionFileCacheSize, 7);

    const cached = index.listHistoricalSessions();
    assert.deepEqual(cached.map((row) => row.summary.appSessionId).sort(), [
      'cache-plain',
      'cache-workspace',
      'forked-session',
    ]);
    for (const id of ['cache-plain', 'cache-workspace', 'forked-session']) {
      const cachedRow = cached.find((row) => row.summary.appSessionId === id);
      assert.ok(cachedRow, `cached list contains ${id}`);
      assert.equal(cachedRow.summary.title, `Chat ${id}`);
      assert.equal(cachedRow.summary.cwd, id === 'cache-plain' ? '' : workspace);
      const file = statSync(join(home, '.factory', 'sessions', `${id}.jsonl`));
      assert.equal(cachedRow.summary.createdAt, file.birthtimeMs);
      assert.equal(cachedRow.summary.updatedAt, file.mtimeMs);
    }
  } finally {
    index.close();
  }

  const rebooted = new HistoryIndex();
  try {
    assert.equal(rebooted.sessionFileCacheSize, 0, 'the main-thread mirror starts without disk IO');
    assert.equal(reconcile(rebooted), 0);
    assert.equal(rebooted.sessionFileCacheSize, 7, 'the worker snapshot hydrates the mirror');
  } finally {
    rebooted.close();
  }
});

test('reconciliation deltas update a second in-memory cache without scanning files', (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'droid-history-cache-delta-'));
  const path = join(dir, 'history.sqlite');
  const writerDb = new DatabaseSync(path);
  const readerDb = new DatabaseSync(path);
  t.after(() => {
    readerDb.close();
    writerDb.close();
    rmSync(dir, { recursive: true, force: true });
  });
  const stat = (providerSessionId: string, mtimeMs: number) =>
    fileStat(`/sessions/${providerSessionId}.jsonl`, mtimeMs);
  const onDisk = new Map<string, SessionFileStat>([
    ['alpha', stat('alpha', 1)],
    ['beta', stat('beta', 1)],
  ]);
  const writer = new SessionFileCache(
    writerDb,
    () => ({ files: onDisk, isComplete: true }),
    (providerSessionId, file) => summaryFor(providerSessionId, file.path),
    () => null,
  );
  const reader = new SessionFileCache(
    readerDb,
    () => {
      throw new Error('reader cache must not scan provider files');
    },
    () => {
      throw new Error('reader cache must not summarize provider files');
    },
    () => null,
  );

  const initial = writer.reconcileChanges();
  assert.equal(initial.changed, 2);
  assert.deepEqual(
    initial.upserts.map((entry) => entry.providerSessionId),
    ['alpha', 'beta'],
  );
  assert.deepEqual(initial.removedProviderSessionIds, []);
  reader.applyReconciliation(initial);
  assert.deepEqual(
    reader.summaries().map((summary) => summary.appSessionId),
    ['alpha', 'beta'],
  );

  onDisk.set('alpha', stat('alpha', 2));
  onDisk.delete('beta');
  const update = writer.reconcileChanges();
  assert.equal(update.changed, 2);
  assert.deepEqual(
    update.upserts.map((entry) => [entry.providerSessionId, entry.mtimeMs]),
    [['alpha', 2]],
  );
  assert.deepEqual(update.removedProviderSessionIds, ['beta']);
  reader.applyReconciliation(update);
  assert.deepEqual(
    reader.searchableEntries().map((entry) => [entry.providerSessionId, entry.mtimeMs]),
    [['alpha', 2]],
  );

  onDisk.set('alpha', { ...stat('alpha', 2), birthtimeMs: 2 });
  const replacement = writer.reconcileChanges();
  assert.equal(
    replacement.changed,
    1,
    'a replacement with the same path, mtime, and size is re-summarized',
  );
  assert.equal(replacement.upserts[0]?.birthtimeMs, 2);
});

test('sessions without a real user turn and a model response never become sidebar rows', (t) => {
  const freshRoot = freshHome(t, 'droid-history-unlisted-');
  const workspace = join(freshRoot, 'workspace-unlisted');
  writeEmptySession(freshRoot, 'metadata-only', workspace);
  writeSession(freshRoot, 'no-response', workspace, {}, ['user']);
  writeFileSync(
    writeEmptySession(freshRoot, 'llm-only-context', workspace),
    `${[
      {
        type: 'session_start',
        cwd: workspace,
        sessionTitle: 'New Session',
        settings: { interactionMode: 'auto' },
      },
      {
        type: 'message',
        message: {
          role: 'user',
          visibility: 'llm_only',
          content: [{ type: 'text', text: 'internal context' }],
        },
      },
      {
        type: 'message',
        message: { role: 'assistant', content: [{ type: 'text', text: 'response' }] },
      },
    ]
      .map((line) => JSON.stringify(line))
      .join('\n')}\n`,
  );
  const index = new HistoryIndex();
  t.after(() => index.close());
  assert.equal(reconcile(index), 3);
  assert.deepEqual(index.listHistoricalSessions({ workspaceCwds: [workspace] }), []);
});

test('opening the canonical index does not open or mutate the worker-owned derived cache', (t) => {
  const upgradeHome = freshHome(t, 'droid-history-cache-upgrade-');
  const existing = new HistoryIndex();
  persistTestSummaries([patchFor('existing-session', '/workspace/existing')]);
  existing.close();

  const upgraded = new HistoryIndex();
  upgraded.close();

  const verified = new DatabaseSync(
    join(upgradeHome, '.factory', 'droidex', SESSION_INDEX_FILENAME),
  );
  const session = verified
    .prepare('SELECT app_session_id, cwd FROM app_sessions WHERE app_session_id = ?')
    .get('existing-session') as { app_session_id: string; cwd: string } | undefined;
  verified.close();
  assert.equal(session?.app_session_id, 'existing-session');
  assert.equal(session?.cwd, '/workspace/existing');
  assert.equal(existsSync(searchIndexPath()), false);
});

test('cached list applies app summary patches and compaction state before filtering', (t) => {
  const workspace = join(home, 'workspace-patch');
  writeSession(home, 'cache-patched', workspace);

  const index = new HistoryIndex();
  t.after(() => index.close());
  reconcile(index);
  persistTestSummaries([
    { ...patchFor('cache-patched', ''), autoCompactions: 3, contextWindowTokens: 200000 },
  ]);

  const plain = index.listHistoricalSessions({ includePlainChats: true });
  const plainRow = plain.find((row) => row.summary.appSessionId === 'cache-patched');
  assert.ok(plainRow);
  assert.equal(plainRow.summary.cwd, '');
  assert.equal(plainRow.summary.workspaceKind, 'none');
  assert.equal(plainRow.summary.autoCompactions, 3);
  assert.equal(plainRow.summary.contextWindowTokens, 200000);

  const scoped = index.listHistoricalSessions({ workspaceCwds: [workspace] });
  assert.equal(
    scoped.some((row) => row.summary.appSessionId === 'cache-patched'),
    false,
  );
});

test('historical compaction markers hydrate the summary generation', (t) => {
  const cwd = join(home, 'workspace-external-compactions');
  writeSession(home, 'external-compactions', cwd);
  const index = new HistoryIndex();
  t.after(() => index.close());
  persistTestSummaries([patchFor('external-compactions', cwd)]);
  for (let i = 0; i < 4; i++) {
    persistTestEvent({
      id: `external-compaction-${String(i)}`,
      appSessionId: 'external-compactions',
      sourceSessionId: 'primary',
      role: 'primary',
      kind: 'compaction',
      ts: i,
    });
    persistTestEvent({
      id: `compaction-external-compactions-summary-${String(i)}`,
      appSessionId: 'external-compactions',
      sourceSessionId: 'external-compactions',
      role: 'primary',
      kind: 'compaction',
      ts: i,
    });
  }
  persistTestEvent({
    id: 'compaction-worker-summary',
    appSessionId: 'external-compactions',
    sourceSessionId: 'worker-1',
    role: 'worker',
    kind: 'compaction',
    ts: 5,
  });
  reconcile(index);

  const rows = index.listHistoricalSessions({ workspaceCwds: [cwd] });

  const row = rows.find((item) => item.summary.appSessionId === 'external-compactions');
  assert.equal(row?.summary.autoCompactions, 4);
});

test('cached list returns every session when no limit is requested', (t) => {
  const cwd = join(home, 'workspace-nolimit');
  for (let i = 0; i < 7; i++) writeSession(home, `nolimit-${i}`, cwd);

  const index = new HistoryIndex();
  t.after(() => index.close());
  reconcile(index);
  const rows = index.listHistoricalSessions({ workspaceCwds: [cwd] });

  assert.equal(rows.filter((row) => row.summary.cwd === cwd).length, 7);
});

test('a corrupt or superseded cache row is dropped and rebuilt on the next boot', (t) => {
  const freshRoot = freshHome(t, 'droid-history-cache-corrupt-');
  const workspace = join(freshRoot, 'workspace');
  writeSession(freshRoot, 'corrupt-row', workspace);
  writeEmptySession(freshRoot, 'previously-cached-empty', workspace);

  const first = new HistoryIndex();
  assert.equal(reconcile(first), 2);
  assert.equal(first.sessionFileCacheSize, 2);
  first.close();

  setCachedSummaryJson('corrupt-row', '{not json');
  const second = new HistoryIndex();
  try {
    // The main-thread mirror never opens the derived database.
    assert.equal(second.sessionFileCacheSize, 0);
    assert.equal(reconcile(second), 1);
    const revisionDb = new DatabaseSync(searchIndexPath(), { readOnly: true });
    const metadata = revisionDb
      .prepare('SELECT revision FROM session_file_cache_metadata WHERE id = 1')
      .get() as { revision: number };
    revisionDb.close();
    assert.equal(
      metadata.revision,
      3,
      'the worker drops the corrupt row and commits its rebuilt replacement',
    );
    const rows = second.listHistoricalSessions();
    assert.ok(rows.some((row) => row.summary.appSessionId === 'corrupt-row'));
  } finally {
    second.close();
  }

  // A null summary, and a row in the shape cached before empty sessions were
  // classified, are both rejected and re-evaluated from the file.
  setCachedSummaryJson('corrupt-row', JSON.stringify({ cacheVersion: 2, summary: null }));
  setCachedSummaryJson(
    'previously-cached-empty',
    JSON.stringify(patchFor('previously-cached-empty', workspace)),
  );
  const rebuilt = new HistoryIndex();
  t.after(() => rebuilt.close());
  assert.equal(rebuilt.sessionFileCacheSize, 0);
  assert.equal(reconcile(rebuilt), 2);
  assert.deepEqual(
    rebuilt.listHistoricalSessions().map((row) => row.summary.appSessionId),
    ['corrupt-row'],
  );
});

test('a settings sidecar change refreshes the cached summary', () => {
  const workspace = join(home, 'workspace-settings');
  writeSession(home, 'cache-settings', workspace);

  const first = new HistoryIndex();
  try {
    reconcile(first);
    const before = first
      .listHistoricalSessions()
      .find((row) => row.summary.appSessionId === 'cache-settings');
    assert.equal(before?.summary.modelId, undefined);
  } finally {
    first.close();
  }

  // The session file is untouched; only its settings sidecar appears.
  writeFileSync(
    join(home, '.factory', 'sessions', 'cache-settings.settings.json'),
    JSON.stringify({ modelId: 'cached-settings-model' }),
  );

  const second = new HistoryIndex();
  try {
    assert.equal(reconcile(second), 1, 'settings mtime drift re-summarizes the session');
    const after = second
      .listHistoricalSessions()
      .find((row) => row.summary.appSessionId === 'cache-settings');
    assert.equal(after?.summary.modelId, 'cached-settings-model');
  } finally {
    second.close();
  }
});

test('reconcileSessionFilePaths touches exactly the reported files', (t) => {
  const workspace = join(home, 'workspace-targeted');
  const keepPath = writeSession(home, 'cache-target-keep', workspace);
  const changePath = writeSession(home, 'cache-target-change', workspace);
  const keep = [{ providerSessionId: 'cache-target-keep', path: keepPath }];
  const change = [{ providerSessionId: 'cache-target-change', path: changePath }];

  const first = new HistoryIndex();
  reconcile(first);
  first.close();

  writeSession(home, 'cache-target-change', workspace, { sessionTitle: 'Targeted rename' });
  // Force a distinct mtime so the change does not depend on clock granularity.
  const later = new Date(Date.now() + 30_000);
  utimesSync(changePath, later, later);

  const second = new HistoryIndex();
  t.after(() => second.close());
  const row = (id: string) =>
    second.listHistoricalSessions().find((entry) => entry.summary.appSessionId === id);
  // An unchanged reported file costs only a stat.
  assert.equal(reconcile(second, keep), 0);
  assert.equal(reconcile(second, change), 1);
  assert.equal(row('cache-target-change')?.summary.title, 'Targeted rename');

  // A reported file that no longer exists is dropped from the cache.
  unlinkSync(changePath);
  assert.equal(reconcile(second, change), 1);
  assert.equal(row('cache-target-change'), undefined);

  // A settings-sidecar-only change (the session file itself untouched)
  // still re-summarizes the reported file.
  writeFileSync(
    join(home, '.factory', 'sessions', 'cache-target-keep.settings.json'),
    JSON.stringify({ modelId: 'targeted-settings-model' }),
  );
  assert.equal(reconcile(second, keep), 1);
  assert.equal(row('cache-target-keep')?.summary.modelId, 'targeted-settings-model');
});

test('an admitted owned chat survives a missing transcript and returns with its DROIDEX title', async (t) => {
  const root = freshHome(t, 'droid-history-owned-');
  const cwd = join(root, 'workspace');
  const providerSessionId = 'owned-provider';
  const appSessionId = 'owned-app';
  const path = writeSession(root, providerSessionId, cwd);
  const owned = { ...patchFor(appSessionId, cwd), providerSessionId, title: 'DROIDEX title' };
  const notice: Protocol.TranscriptEvent = {
    id: 'owned-notice',
    appSessionId,
    sourceSessionId: appSessionId,
    role: 'primary',
    kind: 'status',
    text: 'Saved by DROIDEX',
    ts: 1,
  };
  const index = new HistoryIndex();
  let search = new HistoryIndexDatabase(join(root, '.factory', 'droidex', SESSION_INDEX_FILENAME));
  t.after(async () => await search.close());
  const reconcileOwned = (history: HistoryIndexType, changes?: SessionFileChange[]) => {
    const result = changes
      ? search.reconcileSessionFilePaths(changes)
      : search.reconcileSessionFiles();
    if (!history.applySessionFileReconciliation(result)) {
      history.replaceSessionFileSnapshot(search.sessionFileSnapshot());
    }
  };
  try {
    persistTestSummaries([owned, patchFor('abandoned', cwd)]);
    writeSession(root, 'abandoned', cwd, {}, ['user']);
    appendSessionNotice(providerSessionId, notice);
    reconcileOwned(index);
    assert.deepEqual(
      index.listHistoricalSessions().map(({ summary }) => summary.appSessionId),
      [appSessionId],
    );
    unlinkSync(path);
    reconcileOwned(index, [{ providerSessionId, path }]);
    search.setIdle(true);
    assert.equal(search.isIndexingIncomplete(), false);
    assert.deepEqual(readSessionNotices(appSessionId, providerSessionId, 'primary'), [notice]);
    const rows = index.listHistoricalSessions({ workspaceCwds: [cwd] });
    assert.deepEqual(
      rows.map(({ summary }) => [summary.appSessionId, summary.title]),
      [[appSessionId, 'DROIDEX title']],
    );
  } finally {
    index.close();
    await search.close();
  }

  const restarted = new HistoryIndex();
  search = new HistoryIndexDatabase(join(root, '.factory', 'droidex', SESSION_INDEX_FILENAME));
  try {
    reconcileOwned(restarted);
    search.setIdle(true);
    assert.equal(search.isIndexingIncomplete(), false);
    assert.equal(restarted.listHistoricalSessions()[0]?.summary.appSessionId, appSessionId);
    writeEmptySession(root, providerSessionId, cwd);
    reconcileOwned(restarted, [{ providerSessionId, path }]);
    assert.equal(restarted.listHistoricalSessions()[0]?.summary.appSessionId, appSessionId);
    unlinkSync(path);
    reconcileOwned(restarted);
    assert.equal(search.isIndexingIncomplete(), false);
    writeEmptySession(root, providerSessionId, cwd);
    reconcileOwned(restarted);
    assert.equal(restarted.listHistoricalSessions()[0]?.summary.appSessionId, appSessionId);
    writeSession(root, providerSessionId, cwd);
    reconcileOwned(restarted);
    assert.equal(search.isIndexingIncomplete(), true);
    assert.deepEqual(
      restarted
        .listHistoricalSessions()
        .map(({ summary }) => [summary.appSessionId, summary.title]),
      [[appSessionId, 'DROIDEX title']],
    );
    assert.deepEqual(readSessionNotices(appSessionId, providerSessionId, 'primary'), [notice]);
  } finally {
    restarted.close();
  }
});

test('a file that breaks mid-reconcile is skipped without aborting the diff', (t) => {
  const db = new DatabaseSync(':memory:');
  t.after(() => db.close());
  const onDisk = new Map<string, SessionFileStat>([
    ['good-session', fileStat('/sessions/good.jsonl')],
    ['bad-session', fileStat('/sessions/bad.jsonl')],
  ]);
  const cache = new SessionFileCache(
    db,
    () => ({ files: onDisk, isComplete: true }),
    (providerSessionId, file) => {
      // The bad file vanished between the scan and the read.
      if (providerSessionId === 'bad-session') throw new Error('ENOENT');
      return summaryFor(providerSessionId, file.path);
    },
    () => null,
  );
  assert.equal(
    cache.reconcileChanges().changed,
    1,
    'the good file is cached despite the broken one',
  );
  assert.deepEqual(
    cache.summaries().map((summary) => summary.appSessionId),
    ['good-session'],
  );
});

test('an incomplete tree scan does not delete rows from unreadable subtrees', (t) => {
  const db = new DatabaseSync(':memory:');
  t.after(() => db.close());
  const onDisk = new Map<string, SessionFileStat>([
    ['visible-session', fileStat('/sessions/visible.jsonl')],
    ['temporarily-hidden-session', fileStat('/sessions/hidden/session.jsonl')],
  ]);
  let isComplete = true;
  const cache = new SessionFileCache(
    db,
    () => ({ files: onDisk, isComplete }),
    (providerSessionId, file) => summaryFor(providerSessionId, file.path),
    () => null,
  );
  assert.equal(cache.reconcileChanges().changed, 2);

  onDisk.delete('temporarily-hidden-session');
  isComplete = false;
  assert.equal(
    cache.reconcileChanges().changed,
    0,
    'a partial scan only applies files it could observe',
  );
  assert.deepEqual(
    new Set(cache.summaries().map((summary) => summary.appSessionId)),
    new Set(['visible-session', 'temporarily-hidden-session']),
    'an unreadable subtree does not look like an authoritative deletion',
  );

  isComplete = true;
  assert.equal(
    cache.reconcileChanges().changed,
    1,
    'a later complete scan removes the absent file',
  );
  assert.deepEqual(
    cache.summaries().map((summary) => summary.appSessionId),
    ['visible-session'],
  );
});

test('a SQLite write or delete failure leaves the in-memory cache unchanged', (t) => {
  const db = new DatabaseSync(':memory:');
  t.after(() => db.close());
  const path = '/sessions/cache-failure.jsonl';
  const onDisk = new Map<string, SessionFileStat>([['cache-failure', fileStat(path)]]);
  const cache = new SessionFileCache(
    db,
    () => ({ files: onDisk, isComplete: true }),
    (providerSessionId) => summaryFor(providerSessionId, path),
    (candidate) => (candidate === path ? (onDisk.get('cache-failure') ?? null) : null),
  );
  const failWrites = (operation: 'INSERT' | 'DELETE') =>
    db.exec(`
      CREATE TRIGGER fail_session_file_${operation.toLowerCase()}
      BEFORE ${operation} ON session_file_cache
      BEGIN
        SELECT RAISE(ABORT, 'sqlite busy');
      END
    `);

  failWrites('INSERT');
  assert.throws(() => cache.reconcileChanges(), /sqlite busy/);
  assert.equal(cache.size, 0, 'the in-memory cache holds nothing the database never stored');
  assert.deepEqual(cache.summaries(), []);
  db.exec('DROP TRIGGER fail_session_file_insert');

  assert.equal(cache.reconcileChanges().changed, 1);
  onDisk.clear();
  failWrites('DELETE');
  assert.throws(() => cache.reconcileChanges(), /sqlite busy/);
  assert.equal(cache.size, 1, 'a failed full-reconcile delete keeps the cached row');
  assert.throws(
    () => cache.reconcilePathChanges([{ providerSessionId: 'cache-failure', path }]),
    /sqlite busy/,
  );
  assert.equal(cache.size, 1, 'a failed targeted delete keeps the cached row');
  assert.equal(cache.summaries()[0]?.appSessionId, 'cache-failure');
});

test('the first sessions.list serves discovered rows, and a warm cache publishes one authoritative list', async (t) => {
  const freshRoot = freshHome(t, 'droid-history-cache-warm-');
  const path = writeSession(freshRoot, 'warm-session', join(freshRoot, 'workspace'));
  const sessionLists = async () => {
    const events: Protocol.ServerEvent[] = [];
    const manager = new SessionManager((event) => events.push(event));
    try {
      await manager.handle({ type: 'sessions.list' });
    } finally {
      await manager.shutdown();
    }
    return events.flatMap((event) => (event.type === 'sessions.list' ? [event.sessions] : []));
  };
  const firstBoot = await sessionLists();
  assert.ok(firstBoot.at(-1)?.some((session) => session.appSessionId === 'warm-session'));

  // The file changes while the app is closed.
  writeSession(freshRoot, 'warm-session', join(freshRoot, 'workspace'), {
    sessionTitle: 'Edited elsewhere',
  });
  const later = new Date(Date.now() + 10_000);
  utimesSync(path, later, later);

  const lists = await sessionLists();
  assert.equal(lists.length, 1);
  assert.equal(
    lists[0]?.find((session) => session.appSessionId === 'warm-session')?.title,
    'Edited elsewhere',
  );
});

test('a resumed older chat stays first after reopening the persisted history index', (t) => {
  const cwd = join(home, 'workspace-recency');
  const older = writeSession(home, 'recency-older', cwd);
  const newer = writeSession(home, 'recency-newer', cwd);
  utimesSync(older, 100, 100);
  utimesSync(newer, 200, 200);
  const first = new HistoryIndex();
  reconcile(first);
  persistTestSummaries([
    { ...patchFor('recency-older', cwd), updatedAt: 100_000 },
    { ...patchFor('recency-newer', cwd), updatedAt: 200_000 },
  ]);
  first.close();
  utimesSync(older, 300, 300);
  const restarted = new HistoryIndex();
  t.after(() => restarted.close());
  reconcile(restarted);
  const rows = restarted.listHistoricalSessions({ workspaceCwds: [cwd] });
  assert.equal(rows[0]?.summary.appSessionId, 'recency-older');
  assert.equal(rows[0]?.summary.updatedAt, 300_000);
  persistTestSummaries([{ ...patchFor('recency-older', cwd), updatedAt: 400_000 }]);
  assert.equal(
    restarted.listHistoricalSessions({ workspaceCwds: [cwd] })[0]?.summary.updatedAt,
    400_000,
  );
});
