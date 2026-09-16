import type { DatabaseSync } from 'node:sqlite';

export const CHILD_SESSIONS_TABLE_SCHEMA = `(
  parent_app_session_id TEXT NOT NULL,
  child_session_id TEXT NOT NULL,
  provider_session_id TEXT,
  previous_provider_session_ids TEXT NOT NULL DEFAULT '[]',
  role TEXT NOT NULL CHECK (role IN ('worker', 'validator')),
  label TEXT,
  prompt TEXT,
  group_name TEXT,
  phase TEXT,
  status TEXT NOT NULL CHECK (status IN ('pending', 'running', 'paused', 'completed', 'failed')),
  model_id TEXT NOT NULL,
  reasoning_effort TEXT,
  spawn_link_kind TEXT CHECK (spawn_link_kind IN ('tool-use', 'spawn')),
  spawn_link_id TEXT,
  transcript_available INTEGER NOT NULL CHECK (transcript_available IN (0, 1)),
  started_at INTEGER,
  updated_at INTEGER NOT NULL,
  CHECK (
    (spawn_link_kind IS NULL AND spawn_link_id IS NULL) OR
    (spawn_link_kind IS NOT NULL AND spawn_link_id IS NOT NULL)
  ),
  PRIMARY KEY (parent_app_session_id, child_session_id)
)`;

// Keep direct upgrades from shipped v1/v2 indexes until their support boundary
// closes (PR #103). Rebuilding widens the status CHECK and permits shared spawn links.
export function migrateChildSessionsToV3(db: DatabaseSync, version: 1 | 2): void {
  db.exec('BEGIN IMMEDIATE');
  try {
    if (version === 1) {
      db.exec(`
        ALTER TABLE child_sessions
          ADD COLUMN previous_provider_session_ids TEXT NOT NULL DEFAULT '[]';
      `);
    }
    db.exec(`
      CREATE TABLE child_sessions_v3 ${CHILD_SESSIONS_TABLE_SCHEMA};
      INSERT INTO child_sessions_v3 (
        parent_app_session_id, child_session_id, provider_session_id,
        previous_provider_session_ids, role, label, prompt, status, model_id,
        reasoning_effort, spawn_link_kind, spawn_link_id, transcript_available,
        started_at, updated_at
      )
      SELECT
        parent_app_session_id, child_session_id, provider_session_id,
        previous_provider_session_ids, role, label, prompt, status, model_id,
        reasoning_effort, spawn_link_kind, spawn_link_id, transcript_available,
        started_at, updated_at
      FROM child_sessions;
      DROP TABLE child_sessions;
      ALTER TABLE child_sessions_v3 RENAME TO child_sessions;
      CREATE UNIQUE INDEX child_sessions_provider_identity
        ON child_sessions (parent_app_session_id, provider_session_id)
        WHERE provider_session_id IS NOT NULL;
      PRAGMA user_version = 3;
      COMMIT;
    `);
  } catch (error) {
    try {
      db.exec('ROLLBACK');
    } catch {
      // Preserve the original failure if SQLite already rolled back.
    }
    throw error;
  }
}
