import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import test, { type TestContext } from 'node:test';

import type { OpaqueUsageCursorAdvance, OpaqueUsageIngestBatch } from './UsageSourceContract.js';
import { UsageDatabase, type UsageCursorAdvance, type UsageIngestBatch } from './UsageDatabase.js';
import { createCodexUsageParserState, type UsageEvent } from './types.js';

const NOW = Date.parse('2026-01-03T20:00:00.000Z');

function fixture(t: TestContext, timeZone: string | null = 'UTC') {
  const directory = mkdtempSync(join(tmpdir(), 'droidex-usage-'));
  const databasePath = join(directory, 'usage.sqlite');
  const sourcePath = join(directory, 'codex.jsonl');
  const database = new UsageDatabase({
    databasePath,
    ...(timeZone ? { timeZone } : {}),
    now: () => NOW,
  });
  t.after(() => {
    database.close();
    rmSync(directory, { recursive: true, force: true });
  });
  return { database, databasePath, sourcePath };
}

function guard(value: number): Uint8Array {
  return new Uint8Array(64).fill(value);
}

function nextCursor(
  sourcePath: string,
  overrides: Partial<UsageCursorAdvance> = {},
): UsageCursorAdvance {
  return {
    sourcePath,
    sourceId: `codex:${sourcePath}`,
    fileIdentity: 'device:1:file:1',
    byteOffset: 10,
    fileSize: 10,
    mtimeMs: NOW,
    guard: guard(1),
    parserName: 'codex',
    parserVersion: 1,
    parserState: JSON.stringify(createCodexUsageParserState()),
    discardingOversized: false,
    ...overrides,
  };
}

function usageEvent(sourceId: string, overrides: Partial<UsageEvent> = {}): UsageEvent {
  return {
    dedupeKey: 'request:1',
    harnessId: 'codex',
    harnessDisplayName: 'Codex',
    sourceId,
    sessionId: 'session:1',
    project: '/private/project',
    sessionStartedAtMs: Date.parse('2026-01-01T00:00:00.000Z'),
    tsMs: Date.parse('2026-01-02T07:00:00.000Z'),
    model: 'gpt-6',
    serviceTier: null,
    inputTokens: 100,
    outputTokens: 50,
    cacheWriteTokens: 0,
    cacheReadTokens: 40,
    reasoningTokens: 10,
    providerCostMicrousd: null,
    estimatedCostMicrousd: null,
    pricingVersion: null,
    ...overrides,
  };
}

function opaqueCursor(
  sourcePath: string,
  overrides: Partial<OpaqueUsageCursorAdvance> = {},
): OpaqueUsageCursorAdvance {
  return {
    sourcePath,
    sourceId: `opencode:${sourcePath}`,
    adapterName: 'opencode-sqlite',
    adapterVersion: 1,
    state: JSON.stringify({ fileIdentity: '1:1', tables: {} }),
    ...overrides,
  };
}

function ingest(
  database: UsageDatabase,
  expectedCursor: UsageIngestBatch['expectedCursor'],
  next: UsageCursorAdvance,
  events: UsageEvent[],
  reset = false,
) {
  return database.ingest({ expectedCursor, nextCursor: next, events, reset });
}

test('duplicate replay is idempotent and a stale batch advances neither events nor cursor', (t) => {
  const { database, sourcePath } = fixture(t);
  const firstCursor = nextCursor(sourcePath);
  const event = usageEvent(firstCursor.sourceId);
  const first = ingest(database, null, firstCursor, [event]);
  assert.equal(first.insertedEvents, 1);
  assert.equal(first.cursor.revision, 1);

  const secondCursor = nextCursor(sourcePath, {
    byteOffset: 20,
    fileSize: 20,
    guard: guard(2),
    discardingOversized: true,
  });
  const second = ingest(database, first.cursor, secondCursor, [{ ...event, inputTokens: 999 }]);
  assert.equal(second.insertedEvents, 0);
  assert.equal(second.cursor.revision, 2);
  assert.equal(database.cursor(sourcePath)?.discardingOversized, true);
  assert.equal(database.snapshot().lifetimeTokens, 150);

  const staleCursor = nextCursor(sourcePath, {
    byteOffset: 30,
    fileSize: 30,
    guard: guard(3),
  });
  assert.throws(
    () =>
      ingest(database, first.cursor, staleCursor, [
        usageEvent(firstCursor.sourceId, { dedupeKey: 'request:stale' }),
      ]),
    /cursor is stale/,
  );
  assert.equal(database.cursor(sourcePath)?.byteOffset, 20);
  assert.equal(database.snapshot().totals.events, 1);
});

test('opaque source cursor uses CAS and commits normalized events atomically', (t) => {
  const { database, sourcePath } = fixture(t);
  const firstCursor = opaqueCursor(sourcePath);
  const event = usageEvent(firstCursor.sourceId, {
    dedupeKey: 'opencode:message:1',
    harnessId: 'opencode',
    harnessDisplayName: 'OpenCode',
  });
  const first = database.ingestUsageSource({
    expectedCursor: null,
    nextCursor: firstCursor,
    reset: false,
    events: [event],
  });
  assert.equal(first.insertedEvents, 1);
  assert.equal(first.cursor.revision, 1);

  const advanced = opaqueCursor(sourcePath, {
    state: JSON.stringify({ fileIdentity: '1:1', tables: { message: 1 } }),
  });
  const second = database.ingestUsageSource({
    expectedCursor: first.cursor,
    nextCursor: advanced,
    reset: false,
    events: [event],
  });
  assert.equal(second.insertedEvents, 0);
  assert.equal(second.cursor.revision, 2);

  const staleBatch: OpaqueUsageIngestBatch = {
    expectedCursor: first.cursor,
    nextCursor: opaqueCursor(sourcePath, {
      state: JSON.stringify({ fileIdentity: '1:1', tables: { message: 2 } }),
    }),
    reset: false,
    events: [{ ...event, dedupeKey: 'opencode:message:2' }],
  };
  assert.throws(() => database.ingestUsageSource(staleBatch), /cursor is stale/);
  assert.deepEqual(database.usageSourceCursor(sourcePath, advanced.adapterName), second.cursor);
  assert.equal(database.snapshot().totals.events, 1);
});

test('rotation and truncation require an explicit reset while stale generations are rejected', (t) => {
  const { database, sourcePath } = fixture(t);
  const original = ingest(
    database,
    null,
    nextCursor(sourcePath, { byteOffset: 100, fileSize: 100 }),
    [],
  ).cursor;
  const rotated = nextCursor(sourcePath, {
    fileIdentity: 'device:1:file:2',
    byteOffset: 12,
    fileSize: 12,
    guard: guard(4),
  });
  assert.throws(() => ingest(database, original, rotated, []), /requires an explicit reset/);
  assert.equal(database.cursor(sourcePath)?.revision, 1);

  const accepted = ingest(database, original, rotated, [], true).cursor;
  assert.equal(accepted.revision, 2);
  assert.equal(accepted.fileIdentity, 'device:1:file:2');
  assert.throws(() => ingest(database, original, rotated, [], true), /cursor is stale/);

  const truncated = nextCursor(sourcePath, {
    fileIdentity: accepted.fileIdentity,
    byteOffset: 5,
    fileSize: 5,
    guard: guard(5),
  });
  const reset = ingest(database, accepted, truncated, [], true).cursor;
  assert.equal(reset.revision, 3);
  assert.equal(reset.byteOffset, 5);
});

test('rollups preserve unknown counts and rebuild days for an explicit timezone', (t) => {
  const { database, sourcePath } = fixture(t, 'America/Los_Angeles');
  const cursor = nextCursor(sourcePath, { byteOffset: 30, fileSize: 30 });
  const events = [
    usageEvent(cursor.sourceId, {
      dedupeKey: 'day:1',
      sessionId: 'session:1',
      providerCostMicrousd: 123,
    }),
    usageEvent(cursor.sourceId, {
      dedupeKey: 'day:2',
      sessionId: 'session:2',
      tsMs: Date.parse('2026-01-02T09:00:00.000Z'),
      model: null,
      inputTokens: null,
      outputTokens: null,
      cacheWriteTokens: null,
      cacheReadTokens: null,
      reasoningTokens: null,
      providerCostMicrousd: null,
      estimatedCostMicrousd: 456,
    }),
    usageEvent(cursor.sourceId, {
      dedupeKey: 'day:3',
      sessionId: 'session:3',
      tsMs: Date.parse('2026-01-03T09:00:00.000Z'),
      inputTokens: 0,
      outputTokens: 0,
      cacheWriteTokens: null,
      cacheReadTokens: null,
      reasoningTokens: null,
    }),
  ];
  ingest(database, null, cursor, events);

  const local = database.snapshot();
  assert.equal(local.lifetimeTokens, 150, 'cache and reasoning subsets are not double counted');
  assert.equal(local.sessions, 0, 'harness usage does not create DROIDEX app sessions');
  assert.equal(local.currentStreak, 3);
  assert.equal(local.longestStreak, 3);
  assert.equal(local.peakDayTokens, 150);
  assert.deepEqual(local.days, [
    { date: '2026-01-01', tokens: 150, events: 1, complete: true },
    { date: '2026-01-02', tokens: 0, events: 1, complete: false },
    { date: '2026-01-03', tokens: 0, events: 1, complete: true },
  ]);
  assert.equal(local.totals.cacheWriteTokens, 0);
  assert.equal(local.totals.cacheReadTokens, 40);
  assert.equal(local.totals.reasoningTokens, 10);
  assert.equal(local.totals.providerCostMicrousd, 123);
  assert.equal(local.totals.estimatedCostMicrousd, null);
  assert.equal(local.totals.tokensComplete, false);
  assert.deepEqual(local.coverage.inputTokens, { known: 2, events: 3 });
  assert.deepEqual(local.coverage.cacheReadTokens, { known: 1, events: 3 });

  database.rebuildDaily('UTC');
  const utc = database.snapshot();
  assert.equal(utc.timeZone, 'UTC');
  assert.deepEqual(utc.days, [
    { date: '2026-01-02', tokens: 150, events: 2, complete: false },
    { date: '2026-01-03', tokens: 0, events: 1, complete: true },
  ]);
  assert.equal(utc.totals.events, 3);
});

test('DROIDEX app sessions are idempotent, append-only, and separate from usage sessions', (t) => {
  const { database, databasePath, sourcePath } = fixture(t);
  assert.deepEqual(database.recordDroidexSessions(['app-2', 'app-1', 'app-1']), {
    insertedSessions: 2,
  });
  assert.deepEqual(database.recordDroidexSessions(['app-1']), { insertedSessions: 0 });
  assert.throws(() => database.recordDroidexSessions(['app-3', '']), /session ID is invalid/);
  assert.equal(database.snapshot().totals.events, 0);
  assert.deepEqual(database.snapshot().days, []);

  const cursor = nextCursor(sourcePath);
  ingest(database, null, cursor, [usageEvent(cursor.sourceId)]);
  const snapshot = database.snapshot();
  assert.equal(snapshot.sessions, 2);
  assert.equal(snapshot.harnesses[0]?.sessions, 1);
  database.rebuildDaily();
  assert.equal(database.snapshot().sessions, 2);

  const raw = new DatabaseSync(databasePath);
  assert.deepEqual(
    raw
      .prepare("SELECT name FROM pragma_table_info('droidex_session') ORDER BY cid")
      .all()
      .map((row) => row['name']),
    ['id'],
  );
  assert.throws(() => raw.prepare("UPDATE droidex_session SET id = 'other'").run(), /append-only/);
  assert.throws(() => raw.prepare('DELETE FROM droidex_session').run(), /append-only/);
  raw.close();
});

test('pricing uses the exact model and effective row before updating daily rollups', (t) => {
  const { database, databasePath, sourcePath } = fixture(t);
  const cursor = nextCursor(sourcePath);
  const base = {
    model: 'claude-sonnet-5-5',
    serviceTier: 'standard',
    inputTokens: 1_000_000,
    outputTokens: 0,
    cacheWriteTokens: 0,
    cacheReadTokens: 1_000_000,
    reasoningTokens: 0,
  } as const;
  ingest(database, null, cursor, [
    usageEvent(cursor.sourceId, {
      ...base,
      dedupeKey: 'price:before-change',
      tsMs: Date.parse('2026-10-06T12:00:00.000Z'),
    }),
    usageEvent(cursor.sourceId, {
      ...base,
      dedupeKey: 'price:after-change',
      tsMs: Date.parse('2026-10-08T12:00:00.000Z'),
    }),
    usageEvent(cursor.sourceId, {
      ...base,
      dedupeKey: 'price:before-launch',
      tsMs: Date.parse('2026-09-27T12:00:00.000Z'),
    }),
    usageEvent(cursor.sourceId, {
      ...base,
      dedupeKey: 'price:unofficial-alias',
      model: 'claude-sonnet-5-5[1m]',
      tsMs: Date.parse('2026-10-08T12:00:00.000Z'),
    }),
  ]);

  const raw = new DatabaseSync(databasePath);
  const rows = raw
    .prepare(
      `SELECT dedupe_key, estimated_cost_microusd, pricing_version
       FROM usage_event ORDER BY id`,
    )
    .all()
    .map((row) => ({ ...row }));
  raw.close();
  assert.deepEqual(rows, [
    {
      dedupe_key: 'price:before-change',
      estimated_cost_microusd: 200_000,
      pricing_version: 'anthropic-2026-09-28-standard',
    },
    {
      dedupe_key: 'price:after-change',
      estimated_cost_microusd: 100_000,
      pricing_version: 'anthropic-2026-10-07-standard',
    },
    {
      dedupe_key: 'price:before-launch',
      estimated_cost_microusd: null,
      pricing_version: null,
    },
    {
      dedupe_key: 'price:unofficial-alias',
      estimated_cost_microusd: null,
      pricing_version: null,
    },
  ]);
  assert.equal(database.snapshot().totals.estimatedCostMicrousd, 300_000);
});

test('rebuild reprices estimates from the current catalog without mutating event snapshots', (t) => {
  const { database, databasePath, sourcePath } = fixture(t);
  const price = new DatabaseSync(databasePath);
  price
    .prepare(
      `INSERT INTO model_price (
        model, effective_from, pricing_version, input_microusd_per_mtok,
        output_microusd_per_mtok, cache_write_microusd_per_mtok,
        cache_read_microusd_per_mtok, max_standard_input_tokens
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run('fixture-priced-model', 0, 'fixture-v1', 1_000_000, 0, 0, 0, null);
  price.close();
  const cursor = nextCursor(sourcePath, { byteOffset: 20, fileSize: 20 });
  ingest(database, null, cursor, [
    usageEvent(cursor.sourceId, {
      dedupeKey: 'catalog-correction',
      model: 'fixture-priced-model',
      inputTokens: 1_000_000,
      outputTokens: 0,
      cacheWriteTokens: 0,
      cacheReadTokens: 0,
      reasoningTokens: 0,
    }),
    usageEvent(cursor.sourceId, {
      dedupeKey: 'provider-authoritative',
      model: 'fixture-priced-model',
      inputTokens: 0,
      outputTokens: 0,
      cacheWriteTokens: 0,
      cacheReadTokens: 0,
      reasoningTokens: 0,
      providerCostMicrousd: 123,
    }),
  ]);
  assert.equal(database.snapshot().totals.estimatedCostMicrousd, 1_000_000);

  const correction = new DatabaseSync(databasePath);
  correction
    .prepare(
      `UPDATE model_price SET pricing_version = ?, input_microusd_per_mtok = ?
       WHERE model = ? AND effective_from = 0`,
    )
    .run('fixture-v2', 2_000_000, 'fixture-priced-model');
  const rawBefore = {
    ...correction
      .prepare(
        `SELECT estimated_cost_microusd, pricing_version FROM usage_event
         WHERE dedupe_key = 'catalog-correction'`,
      )
      .get(),
  };
  correction.close();
  assert.deepEqual(rawBefore, {
    estimated_cost_microusd: 1_000_000,
    pricing_version: 'fixture-v1',
  });

  database.rebuildDaily();
  const rebuilt = database.snapshot();
  assert.equal(rebuilt.totals.estimatedCostMicrousd, 2_000_000);
  assert.equal(rebuilt.totals.providerCostMicrousd, 123);

  const verify = new DatabaseSync(databasePath);
  assert.deepEqual(
    {
      ...verify
        .prepare(
          `SELECT estimated_cost_microusd, pricing_version FROM usage_event
           WHERE dedupe_key = 'catalog-correction'`,
        )
        .get(),
    },
    rawBefore,
  );
  verify.close();
});

test('system-timezone ledgers rebuild when the machine timezone changes', (t) => {
  const previousTimeZone = process.env.TZ;
  process.env.TZ = 'America/Los_Angeles';
  t.after(() => {
    if (previousTimeZone === undefined) delete process.env.TZ;
    else process.env.TZ = previousTimeZone;
  });

  const { database, sourcePath } = fixture(t, null);
  const cursor = nextCursor(sourcePath);
  ingest(database, null, cursor, [usageEvent(cursor.sourceId)]);
  assert.deepEqual(database.snapshot().days, [
    { date: '2026-01-01', tokens: 150, events: 1, complete: true },
  ]);

  process.env.TZ = 'UTC';
  const utc = database.snapshot();
  assert.equal(utc.timeZone, 'UTC');
  assert.deepEqual(utc.days, [{ date: '2026-01-02', tokens: 150, events: 1, complete: true }]);
});

test('schema rejects mutation and version drift, and snapshots omit local identities', (t) => {
  const { database, databasePath, sourcePath } = fixture(t);
  const cursor = nextCursor(sourcePath);
  const event = usageEvent(cursor.sourceId, {
    dedupeKey: 'private-dedupe-key',
    sessionId: 'private-session-id',
    project: '/secret/workspace',
  });
  ingest(database, null, cursor, [event]);
  for (const path of [databasePath, `${databasePath}-wal`, `${databasePath}-shm`]) {
    assert.equal(statSync(path).mode & 0o777, 0o600);
  }
  const serialized = JSON.stringify(database.snapshot());
  for (const secret of [
    sourcePath,
    cursor.sourceId,
    event.dedupeKey,
    event.sessionId,
    event.project,
  ]) {
    assert.equal(serialized.includes(secret ?? ''), false);
  }

  const raw = new DatabaseSync(databasePath);
  assert.equal(raw.prepare('PRAGMA user_version').get()?.user_version, 3);
  assert.equal(raw.prepare('PRAGMA journal_mode').get()?.journal_mode, 'wal');
  assert.throws(() => raw.prepare("UPDATE usage_event SET model = 'other'").run(), /append-only/);
  assert.throws(() => raw.prepare('DELETE FROM usage_event').run(), /append-only/);
  raw.exec('DROP VIEW usage_totals');
  raw.close();

  database.close();
  assert.throws(
    () => new UsageDatabase({ databasePath, timeZone: 'UTC' }),
    /incomplete schema.*version 3.*remove it.*rebuild usage/i,
  );

  const futurePath = `${databasePath}.future`;
  const future = new DatabaseSync(futurePath);
  future.exec('PRAGMA user_version = 4');
  future.close();
  assert.throws(
    () => new UsageDatabase({ databasePath: futurePath, timeZone: 'UTC' }),
    /unsupported.*schema.*version 4.*remove it.*rebuild usage/i,
  );
});

test('schema rejects altered core tables even when every object still exists', (t) => {
  const { database, databasePath } = fixture(t);
  database.close();
  const raw = new DatabaseSync(databasePath);
  raw.exec('ALTER TABLE usage_event ADD COLUMN unexpected TEXT');
  raw.close();

  assert.throws(
    () => new UsageDatabase({ databasePath, timeZone: 'UTC' }),
    /unsupported or incomplete schema.*version 3/i,
  );
});
