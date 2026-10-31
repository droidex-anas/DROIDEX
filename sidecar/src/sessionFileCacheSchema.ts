import type { DatabaseSync } from 'node:sqlite';

import { PERMISSION_SEMANTICS_REVISION } from './permissionSemantics.js';
import { SESSION_FILE_SUMMARY_CACHE_VERSION } from './sessionFileSummaryCache.js';
import { stringValue } from './values.js';

const CACHE_COLUMNS = [
  'provider_session_id',
  'path',
  'birthtime_ms',
  'mtime_ms',
  'size_bytes',
  'settings_mtime_ms',
  'summary_json',
  'launch_settings_json',
];

export function initializeSessionFileCacheSchema(db: DatabaseSync): void {
  const isCanonical =
    hasExactColumns(db, 'session_file_cache', CACHE_COLUMNS) &&
    hasExactColumns(db, 'session_file_cache_metadata', [
      'id',
      'revision',
      'permission_semantics_revision',
      'summary_cache_version',
    ]) &&
    db
      .prepare('SELECT permission_semantics_revision FROM session_file_cache_metadata WHERE id = 1')
      .get()?.permission_semantics_revision === PERMISSION_SEMANTICS_REVISION &&
    db.prepare('SELECT summary_cache_version FROM session_file_cache_metadata WHERE id = 1').get()
      ?.summary_cache_version === SESSION_FILE_SUMMARY_CACHE_VERSION;
  if (!isCanonical) {
    db.exec(`
      DROP TABLE IF EXISTS session_file_cache;
      DROP TABLE IF EXISTS session_file_cache_metadata;
    `);
  }
  db.exec(`
    CREATE TABLE IF NOT EXISTS session_file_cache (
      provider_session_id TEXT PRIMARY KEY,
      path TEXT NOT NULL,
      birthtime_ms REAL NOT NULL,
      mtime_ms REAL NOT NULL,
      size_bytes INTEGER NOT NULL,
      settings_mtime_ms REAL,
      summary_json TEXT,
      launch_settings_json TEXT
    );
    CREATE TABLE IF NOT EXISTS session_file_cache_metadata (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      revision INTEGER NOT NULL,
      permission_semantics_revision INTEGER NOT NULL,
      summary_cache_version INTEGER NOT NULL
    );
    INSERT OR IGNORE INTO session_file_cache_metadata (id, revision, permission_semantics_revision, summary_cache_version)
      VALUES (1, 0, ${String(PERMISSION_SEMANTICS_REVISION)}, ${String(SESSION_FILE_SUMMARY_CACHE_VERSION)});
  `);
}

function hasExactColumns(db: DatabaseSync, table: string, expected: readonly string[]): boolean {
  const columns = db
    .prepare(`PRAGMA table_info(${table})`)
    .all()
    .map((row) => stringValue((row as { name: unknown }).name));
  return (
    columns.length === expected.length &&
    expected.every((column, index) => columns[index] === column)
  );
}
