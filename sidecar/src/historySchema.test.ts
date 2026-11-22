import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';

import { assertCanonicalHistorySchema, ensureCanonicalHistorySchema } from './historySchema.js';

test('new and existing canonical histories index provider lookups without changing sessions', () => {
  const db = new DatabaseSync(':memory:');
  const lookupPlan = () =>
    String(
      db
        .prepare('EXPLAIN QUERY PLAN SELECT * FROM app_sessions WHERE provider_session_id = ?')
        .get('shared-provider')?.detail,
    );
  try {
    ensureCanonicalHistorySchema(db);
    assert.match(lookupPlan(), /SEARCH app_sessions/);
    db.exec('DROP INDEX app_sessions_provider_session_id');
    db.exec(`
      INSERT INTO app_sessions (
        app_session_id, provider_session_id, session_purpose, interaction_mode, title, updated_at
      )
      VALUES
        ('app-a', 'shared-provider', 'chat', 'auto', 'First chat', 100),
        ('app-b', 'shared-provider', 'chat', 'auto', 'Second chat', 200)
    `);
    const allSessions = () =>
      db.prepare('SELECT * FROM app_sessions ORDER BY app_session_id').all();
    const stored = allSessions();
    const version = db.prepare('PRAGMA user_version').get();

    assertCanonicalHistorySchema(db);
    ensureCanonicalHistorySchema(db);
    ensureCanonicalHistorySchema(db);

    assert.match(lookupPlan(), /SEARCH app_sessions/);
    assert.deepEqual(allSessions(), stored);
    assert.deepEqual(db.prepare('PRAGMA user_version').get(), version);
  } finally {
    db.close();
  }
});
