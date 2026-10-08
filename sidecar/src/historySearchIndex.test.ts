import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, statSync, unlinkSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import test, { type TestContext } from 'node:test';
import type { SDKMessage } from '@anthropic-ai/claude-agent-sdk';

import { HistorySearchIndex } from './historySearchIndex.js';
import { sqliteFts5UnavailableSkipReason } from './historySearchSchema.js';
import { SessionEventFlow } from './SessionEventFlow.js';
import { ProviderTranscriptFile } from './providers/ProviderTranscriptFile.js';
import { ClaudeEventMapper } from './providers/claude/claudeEvents.js';
import type { SearchableSessionFileEntry } from './sessionFileCache.js';
import { sessionSummary } from './testing/sessionSummaryFixture.js';

const needsFts5 = { skip: sqliteFts5UnavailableSkipReason() };

function createDatabase(path: string): DatabaseSync {
  const db = new DatabaseSync(path);
  db.exec(`
    CREATE TABLE app_sessions (
      app_session_id TEXT PRIMARY KEY,
      provider_session_id TEXT NOT NULL,
      compacted_from_provider_session_ids TEXT NOT NULL DEFAULT '[]',
      updated_at INTEGER NOT NULL
    );
    CREATE TABLE events (id TEXT PRIMARY KEY);
    CREATE TABLE settings (
      scope TEXT PRIMARY KEY,
      value_json TEXT NOT NULL,
      updated_at INTEGER NOT NULL
    );
    INSERT INTO events (id) VALUES ('keep-me');
    PRAGMA user_version = 2;
  `);
  return db;
}

/** A canonical history database in a directory removed after the test. */
function searchDatabase(t: TestContext) {
  const directory = mkdtempSync(join(tmpdir(), 'droid-history-fts-'));
  const dbPath = join(directory, 'history.sqlite');
  const db = createDatabase(dbPath);
  t.after(() => {
    if (db.isOpen) db.close();
    rmSync(directory, { recursive: true, force: true });
  });
  return { directory, db, dbPath };
}

function insertAppSession(
  db: DatabaseSync,
  appSessionId: string,
  providerSessionId: string,
  aliases: string,
  updatedAt: number,
): void {
  db.prepare(
    `INSERT INTO app_sessions (
      app_session_id, provider_session_id, compacted_from_provider_session_ids, updated_at
    ) VALUES (?, ?, ?, ?)`,
  ).run(appSessionId, providerSessionId, aliases, updatedAt);
}

function messageLine(id: string, role: 'user' | 'assistant', text: string, ts: number): string {
  return JSON.stringify({
    id,
    type: 'message',
    timestamp: new Date(ts).toISOString(),
    message: { role, content: [{ type: 'text', text }] },
  });
}

function writeSession(
  directory: string,
  providerSessionId: string,
  lines: string[],
  updatedAt: number,
): SearchableSessionFileEntry {
  const path = join(directory, `${providerSessionId}.jsonl`);
  writeFileSync(path, `${lines.join('\n')}\n`);
  const stat = statSync(path);
  return {
    providerSessionId,
    path,
    birthtimeMs: stat.birthtimeMs,
    mtimeMs: stat.mtimeMs,
    sizeBytes: stat.size,
    summary: sessionSummary({
      appSessionId: providerSessionId,
      cwd: '/repo',
      workspaceKind: 'folder',
      updatedAt,
    }),
  };
}

/** A session holding one user message, written at `ts`. */
function writeMessage(
  directory: string,
  providerSessionId: string,
  text: string,
  ts = 1_000,
): SearchableSessionFileEntry {
  return writeSession(directory, providerSessionId, [messageLine('one', 'user', text, ts)], ts);
}

async function indexPlan(
  index: HistorySearchIndex,
  plan: { pendingEntries: SearchableSessionFileEntry[]; removedFiles: number },
  isStale?: () => boolean,
): Promise<{ indexedFiles: number; removedFiles: number }> {
  let indexedFiles = 0;
  for (const entry of plan.pendingEntries) {
    let slices = 0;
    while (index.needsIndexing(entry) && !isStale?.()) {
      const result = await index.indexSlice(entry, isStale);
      slices += 1;
      if (result.complete) {
        indexedFiles += 1;
        break;
      }
      assert.ok(result.indexedBytes > 0, 'an incomplete index slice must make progress');
      assert.ok(slices < 10_000, 'index reconciliation must remain bounded');
    }
  }
  return { indexedFiles, removedFiles: plan.removedFiles };
}

function reconcileAll(
  index: HistorySearchIndex,
  entries: SearchableSessionFileEntry[],
  isStale?: () => boolean,
) {
  return indexPlan(index, index.reconcileEntries(entries), isStale);
}

function applyChanges(index: HistorySearchIndex, entries: SearchableSessionFileEntry[]) {
  return indexPlan(index, index.applyEntryChanges(entries, []));
}

function rowIds(db: DatabaseSync, providerSessionId: string): number[] {
  return db
    .prepare('SELECT rowid FROM history_search_rows WHERE provider_session_id = ? ORDER BY rowid')
    .all(providerSessionId)
    .map((row) => Number(row['rowid']));
}

test(
  'indexed search excludes Canvas assistant error bodies but retains user-authored text',
  needsFts5,
  async (t) => {
    const { directory, db } = searchDatabase(t);
    const previous = process.env.DROIDEX_USER_DATA_DIR;
    process.env.DROIDEX_USER_DATA_DIR = directory;
    t.after(() => {
      if (previous === undefined) delete process.env.DROIDEX_USER_DATA_DIR;
      else process.env.DROIDEX_USER_DATA_DIR = previous;
    });
    const summary = sessionSummary({ appSessionId: 'claude-search', provider: 'claude' });
    const file = new ProviderTranscriptFile(summary.appSessionId, () => summary);
    const flow = new SessionEventFlow({
      appendTranscript: (event) => {
        void file.append(event);
      },
      flushTranscript: () => undefined,
      applySideEffects: () => undefined,
      resolveChildScope: () => undefined,
      recordUsage: () => undefined,
    });
    const canary = 'CANVAS_INTERNAL_GUIDANCE_7E4B';
    await file.appendPrompt('Port the client.');
    const mapper = new ClaudeEventMapper(summary.appSessionId);
    for (const message of [
      {
        type: 'assistant',
        parent_tool_use_id: null,
        message: { content: [{ type: 'text', text: 'Ported it to v3.' }] },
      },
      {
        type: 'assistant',
        parent_tool_use_id: null,
        error: 'unknown',
        message: {
          content: [
            { type: 'text', text: `Tool failed: ${canary}` },
            {
              type: 'tool_use',
              id: 'canvas-error',
              name: 'mcp__droidex-canvas__canvas_write',
              input: { designId: 'design-1', source: canary },
            },
          ],
        },
      },
    ]) {
      for (const event of mapper.map(message as SDKMessage))
        flow.apply(summary.appSessionId, summary.appSessionId, 'primary', event);
    }
    await file.flush();
    const stat = statSync(file.path);
    const entry: SearchableSessionFileEntry = {
      providerSessionId: summary.appSessionId,
      path: file.path,
      birthtimeMs: stat.birthtimeMs,
      mtimeMs: stat.mtimeMs,
      sizeBytes: stat.size,
      summary,
    };
    const index = new HistorySearchIndex(db);
    assert.equal((await index.indexSlice(entry)).complete, true);
    assert.deepEqual(index.search(canary), []);
    assert.equal(index.search('Ported it')[0]?.matches[0]?.author, 'assistant');
    assert.equal(index.search('Port the client')[0]?.matches[0]?.author, 'user');

    await file.appendPrompt(`Please show ${canary}`);
    const appended = statSync(file.path);
    assert.equal(
      (await index.indexSlice({ ...entry, mtimeMs: appended.mtimeMs, sizeBytes: appended.size }))
        .complete,
      true,
    );
    unlinkSync(file.path);
    const matches = index.search(canary)[0]?.matches;
    assert.equal(matches?.length, 1);
    assert.equal(matches?.[0]?.author, 'user');
    assert.equal(matches?.[0]?.snippet, `Please show ${canary}`);
  },
);

test(
  'indexed search survives raw-file removal and preserves aliases and substring behavior',
  needsFts5,
  async (t) => {
    const { directory, db, dbPath } = searchDatabase(t);
    const entry = writeSession(
      directory,
      'provider-one',
      [
        messageLine('one', 'user', 'hi bro whatsapp, long time no see', 1_000),
        messageLine('two', 'assistant', 'The C++ parser is fixed.', 2_000),
      ],
      5_000,
    );
    insertAppSession(db, 'app-main', 'provider-one', JSON.stringify(['provider-old']), 9_000);

    const index = new HistorySearchIndex(db);
    assert.deepEqual(await reconcileAll(index, [entry]), { indexedFiles: 1, removedFiles: 0 });
    unlinkSync(entry.path);

    const word = await index.search('BRO WHATSAPP');
    assert.equal(word[0]?.appSessionId, 'app-main');
    assert.equal(word[0]?.matches[0]?.author, 'user');
    assert.ok(word[0]?.matches[0]?.snippet.includes('bro whatsapp'));
    assert.deepEqual(await index.search('hi'), []);
    assert.equal((await index.search('C++'))[0]?.matches[0]?.author, 'assistant');

    db.close();
    const reopened = new DatabaseSync(dbPath);
    t.after(() => reopened.close());
    const reopenedIndex = new HistorySearchIndex(reopened);
    assert.equal((await reopenedIndex.search('whatsapp'))[0]?.appSessionId, 'app-main');
    assert.equal(reopened.prepare('PRAGMA user_version').get()?.['user_version'], 2);
    assert.equal((reopened.prepare('SELECT id FROM events').get() as { id: string }).id, 'keep-me');
  },
);

test(
  'canonical provider aliases ignore malformed alias lists for one row',
  needsFts5,
  async (t) => {
    const { directory, db } = searchDatabase(t);
    const entry = writeMessage(directory, 'provider-malformed-alias', 'malformed alias needle');
    const aliasEntry = writeMessage(directory, 'provider-old', 'old alias needle', 2_000);
    insertAppSession(
      db,
      'app-malformed-alias',
      'provider-malformed-alias',
      '["provider-old", 42]',
      1_000,
    );
    const index = new HistorySearchIndex(db);
    await reconcileAll(index, [entry, aliasEntry]);

    assert.equal(index.search('malformed alias')[0]?.appSessionId, 'app-malformed-alias');
    assert.equal(index.search('old alias')[0]?.appSessionId, 'provider-old');
  },
);

test(
  'canonical aliases refresh only when the summary identity revision advances',
  needsFts5,
  async (t) => {
    const { directory, db, dbPath } = searchDatabase(t);
    const entry = writeMessage(directory, 'provider-revision', 'identity revision needle');
    const index = new HistorySearchIndex(db);
    await reconcileAll(index, [entry]);
    assert.equal(index.search('needle')[0]?.appSessionId, 'provider-revision');

    const otherProcess = new DatabaseSync(dbPath);
    t.after(() => otherProcess.close());
    insertAppSession(otherProcess, 'app-revision', 'provider-revision', '[]', 2_000);
    assert.equal(
      index.search('needle')[0]?.appSessionId,
      'provider-revision',
      'a commit without an identity revision cannot force an app_sessions scan',
    );
    otherProcess
      .prepare(
        `INSERT INTO settings (scope, value_json, updated_at)
       VALUES ('history.search_identity_revision', '1', ?)`,
      )
      .run(2_000);
    assert.equal(index.search('needle')[0]?.appSessionId, 'app-revision');
  },
);

test('one high-volume provider cannot starve another matching session', needsFts5, async (t) => {
  const { directory, db } = searchDatabase(t);
  const noisy = writeSession(
    directory,
    'provider-noisy',
    Array.from({ length: 4_200 }, (_, index) =>
      messageLine(`noisy-${String(index)}`, 'assistant', 'shared fairness marker', index),
    ),
    2_000,
  );
  const quiet = writeMessage(directory, 'provider-quiet', 'shared fairness marker', 5_000);
  const index = new HistorySearchIndex(db);
  await reconcileAll(index, [noisy, quiet]);

  assert.deepEqual(
    index
      .search('fairness marker')
      .map((result) => result.appSessionId)
      .sort(),
    ['provider-noisy', 'provider-quiet'],
  );
});

test(
  'overlapping index connections commit each source event exactly once',
  needsFts5,
  async (t) => {
    const { directory, db: firstDb, dbPath } = searchDatabase(t);
    const secondDb = new DatabaseSync(dbPath);
    t.after(() => secondDb.close());
    const entry = writeMessage(directory, 'provider-idempotent', 'idempotent wombat marker');
    const first = new HistorySearchIndex(firstDb);
    const second = new HistorySearchIndex(secondDb);

    await Promise.all([first.indexSlice(entry), second.indexSlice(entry)]);

    assert.equal(rowIds(firstDb, entry.providerSessionId).length, 1);
    assert.equal(first.search('wombat marker')[0]?.matches.length, 1);
  },
);

test(
  'reconciliation indexes only changed files and removes deleted sessions',
  needsFts5,
  async (t) => {
    const { directory, db } = searchDatabase(t);
    const index = new HistorySearchIndex(db);
    const first = writeMessage(directory, 'provider-refresh', 'first version needle');
    assert.equal((await reconcileAll(index, [first])).indexedFiles, 1);
    assert.deepEqual(await reconcileAll(index, [first]), { indexedFiles: 0, removedFiles: 0 });

    const changed = writeSession(
      directory,
      'provider-refresh',
      [messageLine('two', 'assistant', 'second version compass', 2_000)],
      2_000,
    );
    assert.equal((await reconcileAll(index, [changed])).indexedFiles, 1);
    assert.deepEqual(await index.search('needle'), []);
    assert.equal((await index.search('compass'))[0]?.matches[0]?.ts, 2_000);

    assert.deepEqual(await reconcileAll(index, []), { indexedFiles: 0, removedFiles: 1 });
    assert.deepEqual(await index.search('compass'), []);
  },
);

test(
  'a same-size rewrite with a new session revision rebuilds indexed content',
  needsFts5,
  async (t) => {
    const { directory, db } = searchDatabase(t);
    const index = new HistorySearchIndex(db);
    const first = writeMessage(directory, 'provider-same-size', 'first rewrite marker');
    assert.equal((await reconcileAll(index, [first])).indexedFiles, 1);
    const originalDate = new Date(first.mtimeMs);

    const rewritten = writeMessage(directory, 'provider-same-size', 'other rewrite marker', 2_000);
    assert.equal(rewritten.sizeBytes, first.sizeBytes);
    utimesSync(rewritten.path, originalDate, originalDate);
    const sameStatRewrite = { ...rewritten, mtimeMs: first.mtimeMs };

    assert.equal((await applyChanges(index, [sameStatRewrite])).indexedFiles, 1);
    assert.deepEqual(await index.search('first rewrite'), []);
    assert.equal((await index.search('other rewrite'))[0]?.appSessionId, 'provider-same-size');
  },
);

test(
  'an appended session preserves indexed rows and adds only the new tail',
  needsFts5,
  async (t) => {
    const { directory, db } = searchDatabase(t);
    const index = new HistorySearchIndex(db);
    const firstLine = messageLine('one', 'user', 'first immutable transcript row', 1_000);
    await reconcileAll(index, [writeSession(directory, 'provider-append', [firstLine], 1_000)]);
    const firstRowIds = rowIds(db, 'provider-append');

    const appended = writeSession(
      directory,
      'provider-append',
      [firstLine, messageLine('two', 'assistant', 'second appended transcript row', 2_000)],
      2_000,
    );
    assert.equal((await applyChanges(index, [appended])).indexedFiles, 1);

    const ids = rowIds(db, 'provider-append');
    assert.deepEqual(ids.slice(0, firstRowIds.length), firstRowIds);
    assert.equal(ids.length, firstRowIds.length + 1);
    assert.equal((await index.search('second appended'))[0]?.appSessionId, 'provider-append');
  },
);

test(
  'partial indexing resumes from its committed byte cursor after restart',
  needsFts5,
  async (t) => {
    const { directory, db: firstDb, dbPath } = searchDatabase(t);
    const lines = Array.from({ length: 2_000 }, (_, index) =>
      messageLine(
        `resume-${String(index)}`,
        index % 2 === 0 ? 'user' : 'assistant',
        `restartable history row ${String(index)} ${'x'.repeat(120)}`,
        1_000 + index,
      ),
    );
    const entry = writeSession(directory, 'provider-resume', lines, 5_000);
    const rowCount = (db: DatabaseSync) =>
      Number(
        (db.prepare('SELECT count(*) AS count FROM history_search_rows').get() as { count: number })
          .count,
      );
    const firstSlice = await new HistorySearchIndex(firstDb).indexSlice(entry);
    assert.equal(firstSlice.complete, false);
    const rowsBeforeRestart = rowCount(firstDb);
    const state = firstDb
      .prepare(
        'SELECT indexed_bytes, size_bytes FROM history_search_state WHERE provider_session_id = ?',
      )
      .get('provider-resume') as { indexed_bytes: number; size_bytes: number };
    assert.ok(state.indexed_bytes > 0 && state.indexed_bytes < state.size_bytes);
    firstDb.close();

    const reopened = new DatabaseSync(dbPath);
    t.after(() => reopened.close());
    const resumedIndex = new HistorySearchIndex(reopened);
    assert.equal(
      rowCount(reopened),
      rowsBeforeRestart,
      'committed rows survive restart instead of being rebuilt',
    );
    assert.equal((await reconcileAll(resumedIndex, [entry])).indexedFiles, 1);
    assert.equal(
      (await resumedIndex.search('history row 1999'))[0]?.appSessionId,
      'provider-resume',
    );
  },
);

test('invalid persisted byte cursors are discarded and rebuilt safely', needsFts5, async (t) => {
  const { directory, db } = searchDatabase(t);
  const entry = writeMessage(directory, 'provider-invalid-cursor', 'rebuilt cursor needle');
  await reconcileAll(new HistorySearchIndex(db), [entry]);
  db.prepare(
    `UPDATE history_search_state
     SET indexed_bytes = size_bytes + 1
     WHERE provider_session_id = ?`,
  ).run(entry.providerSessionId);

  const reopened = new HistorySearchIndex(db);
  assert.equal(reopened.needsIndexing(entry), true);
  assert.equal((await reconcileAll(reopened, [entry])).indexedFiles, 1);
  assert.equal(reopened.search('cursor needle')[0]?.appSessionId, entry.providerSessionId);
});

test('reconciliation indexes messages before the newest five megabytes', needsFts5, async (t) => {
  const { directory, db } = searchDatabase(t);
  const entry = writeSession(
    directory,
    'provider-oversized',
    [
      messageLine('early', 'user', 'the archival albatross is searchable', 1_000),
      messageLine('filler', 'assistant', 'x'.repeat(5_100_000), 2_000),
      messageLine('tail', 'assistant', 'latest message', 3_000),
    ],
    3_000,
  );

  const index = new HistorySearchIndex(db);
  assert.equal((await reconcileAll(index, [entry])).indexedFiles, 1);
  assert.equal((await index.search('archival albatross'))[0]?.appSessionId, 'provider-oversized');
});

test('stale reconciliation and search stop without publishing results', needsFts5, async (t) => {
  const { directory, db } = searchDatabase(t);
  const entry = writeMessage(directory, 'provider-stale', 'do not publish this needle');
  const index = new HistorySearchIndex(db);
  assert.deepEqual(await reconcileAll(index, [entry], () => true), {
    indexedFiles: 0,
    removedFiles: 0,
  });
  assert.deepEqual(await index.search('needle', () => true), []);
});

test(
  'a corrupt derived search schema rebuilds without touching canonical history rows',
  needsFts5,
  async (t) => {
    const { directory, db } = searchDatabase(t);
    db.exec(`
    CREATE TABLE history_search_metadata (key TEXT PRIMARY KEY, value INTEGER NOT NULL);
    INSERT INTO history_search_metadata (key, value) VALUES ('version', 1);
    CREATE TABLE history_search_state (broken TEXT);
    CREATE TABLE history_search_fts (broken TEXT);
  `);
    const entry = writeMessage(directory, 'provider-recovery', 'recoverable search needle');

    const index = new HistorySearchIndex(db);
    assert.equal((await reconcileAll(index, [entry])).indexedFiles, 1);
    assert.equal((await index.search('needle'))[0]?.appSessionId, 'provider-recovery');
    assert.equal(db.prepare('PRAGMA user_version').get()?.['user_version'], 2);
    assert.equal((db.prepare('SELECT id FROM events').get() as { id: string }).id, 'keep-me');
  },
);
