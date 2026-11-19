import { homedir } from 'node:os';
import type { DatabaseSync } from 'node:sqlite';

import { droidexHistoryDir } from './droidexPaths.js';
import {
  addChatPreferenceColumns,
  addChildSettledAt,
  CHILD_SESSIONS_TABLE_SCHEMA,
  rebuildChildSessionsToV4,
} from './historySchemaMigrations.js';
import { numberValue, stringValue } from './values.js';

const HISTORY_SCHEMA_VERSION = 5;
type HistorySchemaVersion = 1 | 2 | 3 | 4 | 5;

export function ensureCanonicalHistorySchema(db: DatabaseSync): void {
  const row = db.prepare('PRAGMA user_version').get() as Record<string, unknown> | undefined;
  const version = numberValue(row?.user_version) ?? 0;
  const nonEmpty =
    db
      .prepare(
        "SELECT 1 AS present FROM sqlite_schema WHERE type = 'table' AND name NOT LIKE 'sqlite_%' LIMIT 1",
      )
      .get() !== undefined;
  if (!nonEmpty) {
    createSchema(db);
    return;
  }
  if (version === 1 || version === 2) {
    if (!hasCanonicalHistorySchema(db, version)) throw new Error(historySchemaRecovery());
    rebuildChildSessionsToV4(db, version);
  } else if (version === 3 || version === 4) {
    if (!hasCanonicalHistorySchema(db, version)) throw new Error(historySchemaRecovery());
    if (version === 3) addChildSettledAt(db);
  } else if (version !== HISTORY_SCHEMA_VERSION) {
    throw new Error(historySchemaRecovery());
  }
  if (version < HISTORY_SCHEMA_VERSION) addChatPreferenceColumns(db);
  if (!hasCanonicalHistorySchema(db)) throw new Error(historySchemaRecovery());
}

export function assertCanonicalHistorySchema(db: DatabaseSync): void {
  const row = db.prepare('PRAGMA user_version').get() as Record<string, unknown> | undefined;
  if (
    (numberValue(row?.user_version) ?? 0) !== HISTORY_SCHEMA_VERSION ||
    !hasCanonicalHistorySchema(db)
  )
    throw new Error(historySchemaRecovery());
}

export function historySchemaRecovery(): string {
  const dir = droidexHistoryDir();
  const displayDir = dir.startsWith(`${homedir()}/`) ? `~${dir.slice(homedir().length)}` : dir;
  return (
    'DROIDEX canonical history uses an incompatible schema. Quit DROIDEX and back up ' +
    `${displayDir}, including SQLite WAL/SHM files, before repair or restoring a backup. ` +
    'Do not delete the canonical database; provider transcripts cannot rebuild DROIDEX records.'
  );
}

function createSchema(db: DatabaseSync): void {
  db.exec(`
      BEGIN;
      CREATE TABLE IF NOT EXISTS app_sessions (
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
      CREATE TABLE IF NOT EXISTS child_sessions ${CHILD_SESSIONS_TABLE_SCHEMA};
      CREATE UNIQUE INDEX child_sessions_provider_identity
        ON child_sessions (parent_app_session_id, provider_session_id)
        WHERE provider_session_id IS NOT NULL;
      CREATE TABLE IF NOT EXISTS events (
        id TEXT PRIMARY KEY,
        source_session_id TEXT NOT NULL,
        app_session_id TEXT,
        kind TEXT NOT NULL,
        ts INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS features (
        mission_id TEXT NOT NULL,
        feature_id TEXT NOT NULL,
        status TEXT NOT NULL,
        updated_at INTEGER NOT NULL,
        PRIMARY KEY (mission_id, feature_id)
      );
      CREATE TABLE IF NOT EXISTS progress (
        mission_id TEXT NOT NULL,
        key TEXT NOT NULL,
        ts INTEGER NOT NULL,
        PRIMARY KEY (mission_id, key)
      );
      CREATE TABLE IF NOT EXISTS approvals (
        request_id TEXT PRIMARY KEY,
        app_session_id TEXT NOT NULL,
        kind TEXT NOT NULL,
        created_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS questions (
        request_id TEXT PRIMARY KEY,
        app_session_id TEXT NOT NULL,
        created_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS settings (
        scope TEXT PRIMARY KEY,
        value_json TEXT NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS catalog_cache (
        catalog TEXT PRIMARY KEY,
        value_json TEXT NOT NULL,
        updated_at INTEGER NOT NULL
      );
      PRAGMA user_version = ${String(HISTORY_SCHEMA_VERSION)};
      COMMIT;
    `);
}

const CANONICAL_TABLE_COLUMNS = {
  app_sessions: [
    'app_session_id',
    'provider_session_id',
    'compacted_from_provider_session_ids',
    'session_purpose',
    'interaction_mode',
    'title',
    'cwd',
    'workspace_kind',
    'updated_at',
    'model_id',
    'reasoning_effort',
    'fast_mode',
    'context_window_tokens',
    'compaction_model',
    'worker_model_id',
    'worker_reasoning_effort',
    'validator_model_id',
    'validator_reasoning_effort',
    'autonomy',
    'tokens_in',
    'tokens_out',
    'context_tokens',
    'context_remaining_tokens',
    'context_accuracy',
    'context_updated_at',
    'max_context_tokens',
    'auto_compactions',
  ],
  child_sessions: [
    'parent_app_session_id',
    'child_session_id',
    'provider_session_id',
    'previous_provider_session_ids',
    'role',
    'label',
    'prompt',
    'group_name',
    'phase',
    'status',
    'model_id',
    'reasoning_effort',
    'spawn_link_kind',
    'spawn_link_id',
    'transcript_available',
    'started_at',
    'settled_at',
    'updated_at',
  ],
  events: ['id', 'source_session_id', 'app_session_id', 'kind', 'ts'],
  features: ['mission_id', 'feature_id', 'status', 'updated_at'],
  progress: ['mission_id', 'key', 'ts'],
  approvals: ['request_id', 'app_session_id', 'kind', 'created_at'],
  questions: ['request_id', 'app_session_id', 'created_at'],
  settings: ['scope', 'value_json', 'updated_at'],
  catalog_cache: ['catalog', 'value_json', 'updated_at'],
} as const;

// A stored index is canonical for the version it was written at, not for the
// one this build writes: each entry is the child shape that version shipped.
const CHILD_SESSION_COLUMNS_BY_VERSION = {
  1: CANONICAL_TABLE_COLUMNS.child_sessions.filter(
    (column) =>
      column !== 'previous_provider_session_ids' &&
      column !== 'group_name' &&
      column !== 'phase' &&
      column !== 'settled_at',
  ),
  2: CANONICAL_TABLE_COLUMNS.child_sessions.filter(
    (column) => column !== 'group_name' && column !== 'phase' && column !== 'settled_at',
  ),
  3: CANONICAL_TABLE_COLUMNS.child_sessions.filter((column) => column !== 'settled_at'),
  4: CANONICAL_TABLE_COLUMNS.child_sessions,
  5: CANONICAL_TABLE_COLUMNS.child_sessions,
};

// The two chat preferences arrived in v5; every earlier version stored the same
// app_sessions table without them.
const APP_SESSION_COLUMNS_BEFORE_V5 = CANONICAL_TABLE_COLUMNS.app_sessions.filter(
  (column) => column !== 'fast_mode' && column !== 'context_window_tokens',
);

const CHILD_SCHEMA_CHECKS = [
  "check (role in ('worker', 'validator'))",
  "check (spawn_link_kind in ('tool-use', 'spawn'))",
  'check (transcript_available in (0, 1))',
  '(spawn_link_kind is null and spawn_link_id is null)',
  '(spawn_link_kind is not null and spawn_link_id is not null)',
] as const;

const CANONICAL_PRIMARY_KEYS = {
  app_sessions: ['app_session_id'],
  child_sessions: ['parent_app_session_id', 'child_session_id'],
  events: ['id'],
  features: ['mission_id', 'feature_id'],
  progress: ['mission_id', 'key'],
  approvals: ['request_id'],
  questions: ['request_id'],
  settings: ['scope'],
  catalog_cache: ['catalog'],
} as const;

function hasCanonicalHistorySchema(
  db: DatabaseSync,
  version: HistorySchemaVersion = HISTORY_SCHEMA_VERSION,
): boolean {
  for (const table of Object.keys(CANONICAL_TABLE_COLUMNS)) {
    if (
      !hasExactColumns(db, table, canonicalColumns(table, version)) ||
      !hasPrimaryKey(
        db,
        table,
        CANONICAL_PRIMARY_KEYS[table as keyof typeof CANONICAL_PRIMARY_KEYS],
      )
    )
      return false;
  }
  return (
    hasPartialUniqueIndex(
      db,
      'child_sessions_provider_identity',
      ['parent_app_session_id', 'provider_session_id'],
      'provider_session_id is not null',
    ) &&
    (version >= 3 ||
      hasPartialUniqueIndex(
        db,
        'child_sessions_spawn_identity',
        ['parent_app_session_id', 'spawn_link_kind', 'spawn_link_id'],
        'spawn_link_id is not null',
      )) &&
    childSchemaHasChecks(db, version)
  );
}

function canonicalColumns(table: string, version: HistorySchemaVersion): readonly string[] {
  if (table === 'child_sessions') return CHILD_SESSION_COLUMNS_BY_VERSION[version];
  if (table === 'app_sessions')
    return version === 5 ? CANONICAL_TABLE_COLUMNS.app_sessions : APP_SESSION_COLUMNS_BEFORE_V5;
  return CANONICAL_TABLE_COLUMNS[table as keyof typeof CANONICAL_TABLE_COLUMNS];
}

function hasExactColumns(db: DatabaseSync, table: string, expected: readonly string[]): boolean {
  const columns = tableInfo(db, table)
    .map((row) => stringValue(row.name))
    .filter((name) => name !== undefined);
  return columns.length === expected.length && expected.every((column) => columns.includes(column));
}

function hasPrimaryKey(
  db: DatabaseSync,
  table: string,
  expectedColumns: readonly string[],
): boolean {
  const columns = tableInfo(db, table)
    .filter((row) => (numberValue(row.pk) ?? 0) > 0)
    .sort((left, right) => (numberValue(left.pk) ?? 0) - (numberValue(right.pk) ?? 0))
    .map((row) => stringValue(row.name));
  return (
    columns.length === expectedColumns.length &&
    expectedColumns.every((column, position) => columns[position] === column)
  );
}

function tableInfo(db: DatabaseSync, table: string): Record<string, unknown>[] {
  if (!/^[a-z_]+$/.test(table)) return [];
  return db.prepare(`PRAGMA table_info(${table})`).all();
}

function hasPartialUniqueIndex(
  db: DatabaseSync,
  indexName: string,
  expectedColumns: readonly string[],
  expectedPredicate: string,
): boolean {
  const index = (
    db.prepare('PRAGMA index_list(child_sessions)').all() as Record<string, unknown>[]
  ).find((row) => stringValue(row.name) === indexName);
  if (!index || numberValue(index.unique) !== 1 || numberValue(index.partial) !== 1) return false;
  const columns = (
    db.prepare(`PRAGMA index_info(${indexName})`).all() as Record<string, unknown>[]
  ).map((row) => stringValue(row.name));
  const schema = db
    .prepare("SELECT sql FROM sqlite_schema WHERE type = 'index' AND name = ?")
    .get(indexName) as Record<string, unknown> | undefined;
  const sql = stringValue(schema?.sql)?.toLowerCase().replace(/\s+/g, ' ').trim().replace(/;$/, '');
  const expectedSql = `create unique index ${indexName} on child_sessions (${expectedColumns.join(', ')}) where ${expectedPredicate}`;
  return (
    columns.length === expectedColumns.length &&
    expectedColumns.every((column, position) => columns[position] === column) &&
    sql === expectedSql
  );
}

function childSchemaHasChecks(db: DatabaseSync, version: HistorySchemaVersion): boolean {
  const row = db
    .prepare("SELECT sql FROM sqlite_schema WHERE type = 'table' AND name = 'child_sessions'")
    .get() as Record<string, unknown> | undefined;
  const sql = stringValue(row?.sql)?.toLowerCase().replace(/\s+/g, ' ');
  const statusCheck =
    version >= 3
      ? "check (status in ('pending', 'running', 'paused', 'completed', 'failed'))"
      : "check (status in ('pending', 'running', 'paused', 'completed'))";
  return Boolean(
    sql && sql.includes(statusCheck) && CHILD_SCHEMA_CHECKS.every((check) => sql.includes(check)),
  );
}
