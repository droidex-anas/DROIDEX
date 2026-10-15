import type { DatabaseSync } from 'node:sqlite';

export const CURSOR_GUARD_BYTES = 64;
export const SUM_COLUMNS = [
  'input_tokens',
  'output_tokens',
  'cache_write_tokens',
  'cache_read_tokens',
  'reasoning_tokens',
  'provider_cost_microusd',
  'estimated_cost_microusd',
] as const;

const SCHEMA_VERSION = 3;
const UPDATE_TRIGGER = `CREATE TRIGGER usage_event_no_update BEFORE UPDATE ON usage_event BEGIN
  SELECT RAISE(ABORT, 'usage_event is append-only'); END`;
const DELETE_TRIGGER = `CREATE TRIGGER usage_event_no_delete BEFORE DELETE ON usage_event BEGIN
  SELECT RAISE(ABORT, 'usage_event is append-only'); END`;
const DROIDEX_SESSION_UPDATE_TRIGGER = `CREATE TRIGGER droidex_session_no_update BEFORE UPDATE ON droidex_session BEGIN
  SELECT RAISE(ABORT, 'droidex_session is append-only'); END`;
const DROIDEX_SESSION_DELETE_TRIGGER = `CREATE TRIGGER droidex_session_no_delete BEFORE DELETE ON droidex_session BEGIN
  SELECT RAISE(ABORT, 'droidex_session is append-only'); END`;
const SESSION_MODEL_INDEX =
  'CREATE INDEX usage_session_model_model ON usage_session_model(model) WHERE model IS NOT NULL';

export function initializeUsageSchema(db: DatabaseSync, databasePath: string): void {
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;
    PRAGMA synchronous = NORMAL;
    PRAGMA busy_timeout = 5000;
  `);
  const version = pragmaNumber(db, 'PRAGMA user_version', 'user_version');
  const tableCount = pragmaNumber(
    db,
    "SELECT COUNT(*) AS value FROM sqlite_schema WHERE type = 'table' AND name NOT LIKE 'sqlite_%'",
    'value',
  );
  if (version === 0 && tableCount === 0) {
    createSchema(db);
    return;
  }
  const tables = usageTableSql();
  if (
    version !== SCHEMA_VERSION ||
    Object.entries(tables).some(([name, sql]) => !hasSqlObject(db, 'table', name, sql)) ||
    !hasSqlObject(db, 'index', 'usage_session_model_model', SESSION_MODEL_INDEX) ||
    !hasSqlObject(db, 'trigger', 'usage_event_no_update', UPDATE_TRIGGER) ||
    !hasSqlObject(db, 'trigger', 'usage_event_no_delete', DELETE_TRIGGER) ||
    !hasSqlObject(db, 'trigger', 'droidex_session_no_update', DROIDEX_SESSION_UPDATE_TRIGGER) ||
    !hasSqlObject(db, 'trigger', 'droidex_session_no_delete', DROIDEX_SESSION_DELETE_TRIGGER) ||
    !hasSqlObject(db, 'view', 'usage_totals', usageTotalsViewSql())
  ) {
    throw schemaError(databasePath, version);
  }
}

export function dailyUpsertSql(): string {
  const columns = SUM_COLUMNS.flatMap((name) => [name, `${name}_known_events`]);
  const updates = SUM_COLUMNS.flatMap((name) => [
    `${name} = CASE WHEN usage_daily.${name} IS NULL THEN excluded.${name} WHEN excluded.${name} IS NULL THEN usage_daily.${name} ELSE usage_daily.${name} + excluded.${name} END`,
    `${name}_known_events = usage_daily.${name}_known_events + excluded.${name}_known_events`,
  ]);
  return `INSERT INTO usage_daily (day, harness_id, model_key, model, event_count, ${columns.join(',')})
    VALUES (${Array.from({ length: 5 + columns.length }, () => '?').join(',')})
    ON CONFLICT(day, harness_id, model_key) DO UPDATE SET
      event_count = usage_daily.event_count + 1, ${updates.join(',')}`;
}

function createSchema(db: DatabaseSync): void {
  const tables = usageTableSql();
  const createTables = Object.values(tables)
    .map((sql) => `${sql};`)
    .join('\n');
  db.exec(`
    BEGIN IMMEDIATE;
    ${createTables}
    ${SESSION_MODEL_INDEX};
    ${UPDATE_TRIGGER};
    ${DELETE_TRIGGER};
    ${DROIDEX_SESSION_UPDATE_TRIGGER};
    ${DROIDEX_SESSION_DELETE_TRIGGER};
    ${usageTotalsViewSql()};
    PRAGMA user_version = ${String(SCHEMA_VERSION)};
    COMMIT;
  `);
}

function usageTableSql(): Record<string, string> {
  const nullableIntegers = SUM_COLUMNS.map(
    (name) =>
      `${name} INTEGER CHECK (${name} IS NULL OR (typeof(${name}) = 'integer' AND ${name} >= 0))`,
  ).join(',');
  const dailyIntegers = SUM_COLUMNS.map(
    (name) =>
      `${name} INTEGER CHECK (${name} IS NULL OR ${name} >= 0), ${name}_known_events INTEGER NOT NULL CHECK (${name}_known_events >= 0)`,
  ).join(',');
  return {
    droidex_session: 'CREATE TABLE droidex_session (id TEXT PRIMARY KEY)',
    harness: 'CREATE TABLE harness (id TEXT PRIMARY KEY, display_name TEXT NOT NULL)',
    usage_session: `CREATE TABLE usage_session (
      harness_id TEXT NOT NULL REFERENCES harness(id), id TEXT NOT NULL,
      project TEXT, started_at INTEGER, PRIMARY KEY (harness_id, id)
    )`,
    usage_session_model: `CREATE TABLE usage_session_model (
      harness_id TEXT NOT NULL, session_id TEXT NOT NULL, model_key TEXT NOT NULL, model TEXT,
      PRIMARY KEY (harness_id, session_id, model_key),
      FOREIGN KEY (harness_id, session_id) REFERENCES usage_session(harness_id, id),
      CHECK ((model IS NULL AND model_key = '') OR model_key = model)
    )`,
    usage_event: `CREATE TABLE usage_event (
      id INTEGER PRIMARY KEY, dedupe_key TEXT NOT NULL, harness_id TEXT NOT NULL REFERENCES harness(id),
      source_id TEXT NOT NULL, session_id TEXT, project TEXT, session_started_at INTEGER,
      ts INTEGER NOT NULL CHECK (ts >= 0),
      model TEXT, service_tier TEXT, ${nullableIntegers}, pricing_version TEXT,
      UNIQUE (harness_id, dedupe_key),
      FOREIGN KEY (harness_id, session_id) REFERENCES usage_session(harness_id, id)
    )`,
    model_price: modelPriceTableSql(),
    ingest_cursor: `CREATE TABLE ingest_cursor (
      source_path TEXT PRIMARY KEY, source_id TEXT NOT NULL, file_identity TEXT NOT NULL,
      byte_offset INTEGER NOT NULL CHECK (byte_offset >= 0), file_size INTEGER NOT NULL CHECK (file_size >= byte_offset),
      mtime_ms INTEGER NOT NULL CHECK (mtime_ms >= 0), guard BLOB NOT NULL CHECK (length(guard) = ${String(CURSOR_GUARD_BYTES)}),
      parser_name TEXT NOT NULL, parser_version INTEGER NOT NULL CHECK (parser_version > 0),
      parser_state TEXT NOT NULL, discarding_oversized INTEGER NOT NULL CHECK (discarding_oversized IN (0, 1)),
      revision INTEGER NOT NULL CHECK (revision > 0)
    )`,
    usage_source_cursor: `CREATE TABLE usage_source_cursor (
      source_path TEXT NOT NULL, source_id TEXT NOT NULL, adapter_name TEXT NOT NULL,
      adapter_version INTEGER NOT NULL CHECK (adapter_version > 0), state TEXT NOT NULL,
      revision INTEGER NOT NULL CHECK (revision > 0), PRIMARY KEY (adapter_name, source_path)
    )`,
    usage_daily: `CREATE TABLE usage_daily (
      day TEXT NOT NULL, harness_id TEXT NOT NULL REFERENCES harness(id), model_key TEXT NOT NULL,
      model TEXT, event_count INTEGER NOT NULL CHECK (event_count > 0), ${dailyIntegers},
      PRIMARY KEY (day, harness_id, model_key),
      CHECK ((model IS NULL AND model_key = '') OR model_key = model)
    )`,
    rollup_state: `CREATE TABLE rollup_state (
      id INTEGER PRIMARY KEY CHECK (id = 1), timezone TEXT NOT NULL,
      event_count INTEGER NOT NULL CHECK (event_count >= 0), first_event_at INTEGER,
      updated_at INTEGER NOT NULL,
      CHECK (first_event_at IS NULL OR first_event_at >= 0)
    )`,
  };
}

function modelPriceTableSql(): string {
  return `CREATE TABLE model_price (
    model TEXT NOT NULL, effective_from INTEGER NOT NULL CHECK (effective_from >= 0),
    pricing_version TEXT NOT NULL,
    input_microusd_per_mtok INTEGER CHECK (input_microusd_per_mtok IS NULL OR input_microusd_per_mtok >= 0),
    output_microusd_per_mtok INTEGER CHECK (output_microusd_per_mtok IS NULL OR output_microusd_per_mtok >= 0),
    cache_write_microusd_per_mtok INTEGER CHECK (cache_write_microusd_per_mtok IS NULL OR cache_write_microusd_per_mtok >= 0),
    cache_read_microusd_per_mtok INTEGER CHECK (cache_read_microusd_per_mtok IS NULL OR cache_read_microusd_per_mtok >= 0),
    max_standard_input_tokens INTEGER CHECK (max_standard_input_tokens IS NULL OR max_standard_input_tokens > 0),
    PRIMARY KEY (model, effective_from)
  )`;
}

function hasSqlObject(db: DatabaseSync, type: string, name: string, expected: string): boolean {
  const sql = db
    .prepare('SELECT sql FROM sqlite_schema WHERE type = ? AND name = ?')
    .get(type, name)?.sql;
  return typeof sql === 'string' && normalizeSql(sql) === normalizeSql(expected);
}

function usageTotalsViewSql(): string {
  const totals = SUM_COLUMNS.map(
    (name) => `SUM(${name}) AS ${name}, COALESCE(SUM(${name}_known_events), 0) AS ${name}_known`,
  ).join(',');
  return `CREATE VIEW usage_totals AS SELECT COALESCE(SUM(event_count), 0) AS events, ${totals} FROM usage_daily`;
}

function normalizeSql(sql: string): string {
  return sql.replace(/\s+/g, ' ').trim().toLowerCase();
}

function pragmaNumber(db: DatabaseSync, sql: string, key: string): number {
  const value = db.prepare(sql).get()?.[key];
  if (typeof value !== 'number' || !Number.isSafeInteger(value)) {
    throw new Error('Usage database metadata is corrupt.');
  }
  return value;
}

function schemaError(databasePath: string, version: number): Error {
  return new Error(
    `Usage database ${databasePath} has an unsupported or incomplete schema (version ${String(version)}). Back it up, remove it, and restart DROIDEX to rebuild usage from local harness logs.`,
  );
}
