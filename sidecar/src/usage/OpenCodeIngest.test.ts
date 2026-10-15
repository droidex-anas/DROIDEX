import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import test, { type TestContext } from 'node:test';

import { OpenCodeIngest, openCodeDataRoots } from './OpenCodeIngest.js';
import type {
  OpaqueUsageCursor,
  OpaqueUsageIngestBatch,
  OpaqueUsageSourceStore,
} from './UsageSourceContract.js';
import type { UsageEvent } from './types.js';

test('resolves OpenCode roots from OPENCODE_DATA_DIR before XDG defaults', () => {
  const home = resolve('/tmp/droidex-opencode-home');
  assert.deepEqual(
    openCodeDataRoots(
      {
        OPENCODE_DATA_DIR: `~/one, ${home}/two`,
        XDG_DATA_HOME: `${home}/ignored`,
      },
      home,
    ),
    [join(home, 'one'), join(home, 'two')],
  );
  assert.deepEqual(openCodeDataRoots({ XDG_DATA_HOME: `${home}/xdg` }, home), [
    join(home, 'xdg/opencode'),
  ]);
  assert.deepEqual(openCodeDataRoots({}, home), [join(home, '.local/share/opencode')]);
});

test('reads both OpenCode SQLite schemas and resumes from persisted row cursors', async (t) => {
  const root = await temporaryRoot(t);
  const currentPath = join(root, 'opencode.db');
  const namedPath = join(root, 'opencode-team.db');
  const current = createDatabase(currentPath, 'message');
  insertMessage(current, 'message', 'message-1', openCodeMessage({ cost: 1.25 }), 100);
  insertMessage(current, 'message', 'ignored-user', JSON.stringify({ role: 'user' }), 101);
  insertMessage(current, 'message', 'malformed', '{bad-json', 102);
  const oversized = `${openCodeMessage().slice(0, -1)},"padding":"${'x'.repeat(1_048_576)}"}`;
  insertMessage(current, 'message', 'oversized', oversized, 103);
  insertMessage(current, 'message', 'long-model', openCodeMessage({ model: 'm'.repeat(161) }), 104);
  insertMessage(
    current,
    'message',
    'future-date',
    openCodeMessage({ timestamp: 8.64e15 + 1 }),
    105,
  );
  current.close();
  const named = createDatabase(namedPath, 'session_message');
  insertMessage(named, 'session_message', 'message-2', openCodeMessage({ modelID: true }), 200);
  named.close();

  const store = new MemoryStore();
  const first = await new OpenCodeIngest({ store, roots: [root], pageSize: 1 }).reconcile();
  assert.deepEqual(first, {
    discoveredDatabases: 2,
    processedDatabases: 2,
    insertedEvents: 2,
    malformedRows: 4,
    unavailableSources: 0,
    backlog: false,
  });
  const event = store.events.get('opencode:message-1');
  assert.ok(event);
  assert.equal(event.inputTokens, 125);
  assert.equal(event.outputTokens, 50);
  assert.equal(event.cacheReadTokens, 20);
  assert.equal(event.cacheWriteTokens, 5);
  assert.equal(event.reasoningTokens, 10);
  assert.equal(event.providerCostMicrousd, 1_250_000);
  assert.equal(event.model, 'openai/gpt-5');
  assert.equal(store.events.has('opencode:future-date'), false);

  const writer = new DatabaseSync(currentPath);
  insertMessage(writer, 'message', 'message-3', openCodeMessage({ timestamp: 300 }), 300);
  writer.close();
  const restarted = await new OpenCodeIngest({ store, roots: [root] }).reconcile();
  assert.equal(restarted.insertedEvents, 1);
  assert.equal(restarted.malformedRows, 0);
  assert.equal(store.events.size, 3);
});

test('captures a row high-water mark before paging live databases', async (t) => {
  const root = await temporaryRoot(t);
  const path = join(root, 'opencode.db');
  const writer = createDatabase(path, 'message');
  writer.exec('PRAGMA journal_mode = WAL');
  insertMessage(writer, 'message', 'before-1', openCodeMessage({ timestamp: 100 }), 100);
  insertMessage(writer, 'message', 'before-2', openCodeMessage({ timestamp: 200 }), 200);
  const store = new MemoryStore(() => {
    insertMessage(writer, 'message', 'after-high-water', openCodeMessage({ timestamp: 300 }), 300);
  });
  t.after(() => writer.close());

  const ingest = new OpenCodeIngest({
    store,
    roots: [root],
    pageSize: 64,
    maxPagesPerReconcile: 1,
    maxRowsPerReconcile: 1,
  });
  const first = await ingest.reconcile();
  assert.equal(first.insertedEvents, 1);
  assert.equal(first.backlog, true);
  assert.equal(store.events.has('opencode:after-high-water'), false);
  const second = await ingest.reconcile();
  assert.equal(second.insertedEvents, 1);
  assert.equal(second.backlog, true);
  const converged = await ingest.reconcile();
  assert.equal(converged.insertedEvents, 1);
  assert.equal(converged.backlog, false);
  assert.equal(store.events.has('opencode:after-high-water'), true);
});

test('revisits an unfinished assistant row after OpenCode finalizes it in place', async (t) => {
  const root = await temporaryRoot(t);
  const path = join(root, 'opencode.db');
  const writer = createDatabase(path, 'message');
  insertMessage(
    writer,
    'message',
    'updated-message',
    JSON.stringify({
      role: 'assistant',
      time: { created: 100 },
      model: { id: 'openai/gpt-5' },
    }),
    100,
  );
  writer.close();

  const store = new MemoryStore();
  const ingest = new OpenCodeIngest({ store, roots: [root] });
  const initial = await ingest.reconcile();
  assert.equal(initial.insertedEvents, 0);
  assert.match(store.onlyCursor().state, /"after":1/);
  assert.match(store.onlyCursor().state, /"unfinished":\[1\]/);

  const update = new DatabaseSync(path);
  update
    .prepare('UPDATE message SET data = ? WHERE id = ?')
    .run(openCodeMessage({ timestamp: 100 }), 'updated-message');
  update.close();

  assert.equal((await ingest.reconcile()).insertedEvents, 1);
  assert.equal(store.events.get('opencode:updated-message')?.outputTokens, 50);
  assert.equal((await ingest.reconcile()).insertedEvents, 0);
  assert.equal(store.events.size, 1);
});

test('reserves forward budget and rotates persistently unfinished rows', async (t) => {
  const root = await temporaryRoot(t);
  const path = join(root, 'opencode.db');
  const writer = createDatabase(path, 'message');
  for (let row = 1; row <= 4; row += 1) {
    insertMessage(
      writer,
      'message',
      `unfinished-${String(row)}`,
      JSON.stringify({ role: 'assistant', time: { created: row } }),
      row,
    );
  }
  writer.close();

  const store = new MemoryStore();
  await new OpenCodeIngest({ store, roots: [root] }).reconcile();
  const append = new DatabaseSync(path);
  insertMessage(append, 'message', 'finalized', openCodeMessage({ timestamp: 5 }), 5);
  append.close();

  const ingest = new OpenCodeIngest({
    store,
    roots: [root],
    pageSize: 1,
    maxPagesPerReconcile: 2,
    maxRowsPerReconcile: 2,
  });
  const first = await ingest.reconcile();
  assert.equal(first.insertedEvents, 1);
  assert.equal(first.backlog, false);
  assert.ok(store.events.has('opencode:finalized'));
  assert.match(store.onlyCursor().state, /"unfinished":\[2,3,4,1\]/);

  assert.equal((await ingest.reconcile()).backlog, false);
  assert.match(store.onlyCursor().state, /"unfinished":\[3,4,1,2\]/);
});

test('bounds each pass by serialized row bytes', async (t) => {
  const root = await temporaryRoot(t);
  const path = join(root, 'opencode.db');
  const writer = createDatabase(path, 'message');
  const padding = 'x'.repeat(700_000);
  for (let row = 1; row <= 3; row += 1) {
    const message = JSON.parse(openCodeMessage({ timestamp: row })) as Record<string, unknown>;
    insertMessage(
      writer,
      'message',
      `large-${String(row)}`,
      JSON.stringify({ ...message, padding }),
      row,
    );
  }
  writer.close();

  const store = new MemoryStore();
  const ingest = new OpenCodeIngest({
    store,
    roots: [root],
    pageSize: 64,
    maxBytesPerReconcile: 2 * 1_024 * 1_024,
  });
  const first = await ingest.reconcile();
  assert.equal(first.insertedEvents, 2);
  assert.equal(first.backlog, true);
  const second = await ingest.reconcile();
  assert.equal(second.insertedEvents, 1);
  assert.equal(second.backlog, false);
});

test('rotates a bounded pass across multiple databases', async (t) => {
  const root = await temporaryRoot(t);
  for (const [name, prefix] of [
    ['opencode.db', 'primary'],
    ['opencode-team.db', 'team'],
  ] as const) {
    const writer = createDatabase(join(root, name), 'message');
    insertMessage(writer, 'message', `${prefix}-1`, openCodeMessage({ timestamp: 1 }), 1);
    insertMessage(writer, 'message', `${prefix}-2`, openCodeMessage({ timestamp: 2 }), 2);
    writer.close();
  }

  const store = new MemoryStore();
  const ingest = new OpenCodeIngest({
    store,
    roots: [root],
    pageSize: 1,
    maxPagesPerReconcile: 1,
    maxRowsPerReconcile: 1,
  });
  assert.equal((await ingest.reconcile()).backlog, true);
  assert.ok(store.events.has('opencode:primary-1'));
  assert.equal((await ingest.reconcile()).backlog, true);
  assert.ok(store.events.has('opencode:team-1'));
  assert.equal(store.events.size, 2);
});

class MemoryStore implements OpaqueUsageSourceStore {
  readonly events = new Map<string, UsageEvent>();
  private readonly cursors = new Map<string, OpaqueUsageCursor>();
  private didIngest = false;

  constructor(private readonly onFirstIngest?: () => void) {}

  usageSourceCursor(sourcePath: string, adapterName: string): OpaqueUsageCursor | null {
    const cursor = this.cursors.get(`${adapterName}\0${sourcePath}`);
    return cursor ? structuredClone(cursor) : null;
  }

  onlyCursor(): OpaqueUsageCursor {
    const cursor = this.cursors.values().next().value;
    assert.ok(cursor);
    return structuredClone(cursor);
  }

  ingestUsageSource(batch: OpaqueUsageIngestBatch) {
    const key = `${batch.nextCursor.adapterName}\0${batch.nextCursor.sourcePath}`;
    const current = this.cursors.get(key) ?? null;
    assert.equal(current?.revision ?? null, batch.expectedCursor?.revision ?? null);
    let insertedEvents = 0;
    for (const event of batch.events) {
      if (this.events.has(event.dedupeKey)) continue;
      this.events.set(event.dedupeKey, structuredClone(event));
      insertedEvents += 1;
    }
    const cursor = { ...batch.nextCursor, revision: (current?.revision ?? 0) + 1 };
    this.cursors.set(key, cursor);
    if (!this.didIngest) {
      this.didIngest = true;
      this.onFirstIngest?.();
    }
    return { insertedEvents, cursor: structuredClone(cursor) };
  }
}

async function temporaryRoot(t: TestContext): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'droidex-opencode-'));
  const root = join(directory, 'opencode');
  await mkdir(root);
  t.after(() => rm(directory, { force: true, recursive: true }));
  return root;
}

function createDatabase(path: string, table: 'message' | 'session_message'): DatabaseSync {
  const db = new DatabaseSync(path);
  db.exec(`
    CREATE TABLE ${table} (
      id TEXT PRIMARY KEY,
      session_id TEXT,
      ${table === 'session_message' ? 'type TEXT,' : ''}
      data TEXT NOT NULL,
      time_created INTEGER
    )
  `);
  return db;
}

function insertMessage(
  db: DatabaseSync,
  table: 'message' | 'session_message',
  id: string,
  data: string,
  created: number,
): void {
  const columns =
    table === 'session_message'
      ? 'id, session_id, type, data, time_created'
      : 'id, session_id, data, time_created';
  const values = table === 'session_message' ? '?, ?, ?, ?, ?' : '?, ?, ?, ?';
  const params =
    table === 'session_message'
      ? [id, 'session-1', 'assistant', data, created]
      : [id, 'session-1', data, created];
  db.prepare(`INSERT INTO ${table} (${columns}) VALUES (${values})`).run(...params);
}

function openCodeMessage(
  options: { cost?: number; model?: string; modelID?: boolean; timestamp?: number } = {},
): string {
  const timestamp = options.timestamp ?? 100;
  return JSON.stringify({
    role: 'assistant',
    time: { created: timestamp, completed: timestamp + 1 },
    ...(options.modelID
      ? { modelID: 'anthropic/claude-sonnet-4' }
      : { model: { id: options.model ?? 'openai/gpt-5' } }),
    tokens: {
      input: 100,
      output: 40,
      reasoning: 10,
      cache: { read: 20, write: 5 },
    },
    ...(options.cost === undefined ? {} : { cost: options.cost }),
  });
}
