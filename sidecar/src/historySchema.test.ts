import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';

import { assertCanonicalHistorySchema, ensureCanonicalHistorySchema } from './historySchema.js';

test('opening an existing canonical history indexes provider lookups without changing sessions', () => {
  const db = new DatabaseSync(':memory:');
  try {
    ensureCanonicalHistorySchema(db);
    db.exec('DROP INDEX IF EXISTS app_sessions_provider_session_id');
    db.exec(`
      INSERT INTO app_sessions (
        app_session_id, provider_session_id, session_purpose, interaction_mode, title, updated_at
      )
      VALUES
        ('app-a', 'shared-provider', 'chat', 'auto', 'First chat', 100),
        ('app-b', 'shared-provider', 'chat', 'auto', 'Second chat', 200)
    `);
    const lookup = 'SELECT * FROM app_sessions WHERE provider_session_id = ?';
    const allSessions = () =>
      db.prepare('SELECT * FROM app_sessions ORDER BY app_session_id').all();
    const stored = allSessions();
    const version = db.prepare('PRAGMA user_version').get();

    assertCanonicalHistorySchema(db);
    ensureCanonicalHistorySchema(db);
    ensureCanonicalHistorySchema(db);

    assert.match(
      String(db.prepare(`EXPLAIN QUERY PLAN ${lookup}`).get('shared-provider')?.detail),
      /SEARCH app_sessions/,
    );
    assert.deepEqual(allSessions(), stored);
    assert.deepEqual(db.prepare('PRAGMA user_version').get(), version);
  } finally {
    db.close();
  }
});
