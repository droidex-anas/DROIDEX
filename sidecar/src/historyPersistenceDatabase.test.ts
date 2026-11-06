import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';

import { HistoryIndex } from './history.js';
import { HistoryPersistenceDatabase } from './historyPersistenceDatabase.js';

test('a writer lease held by a live process blocks another writer only when it was written this boot', (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'history-lease-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const dbPath = join(dir, 'history.sqlite');
  const db = new DatabaseSync(dbPath);
  HistoryIndex.initializeOrValidateHistorySchema(db);
  // This process stands in for an unrelated one that reused the recorded id.
  const otherWriter = JSON.stringify({ owner: 'other', generation: 1, processId: process.pid });
  const recordLease = db.prepare(`
    INSERT INTO settings (scope, value_json, updated_at)
    VALUES ('history.persistence_writer_lease', ?, ?)
    ON CONFLICT(scope) DO UPDATE SET value_json = excluded.value_json, updated_at = excluded.updated_at
  `);
  const lease = { owner: 'this', generation: 1, processId: process.pid };

  recordLease.run(otherWriter, Date.now());
  const blocked = new HistoryPersistenceDatabase(dbPath);
  assert.throws(() => blocked.durabilityBarrier(lease), /owned by another live worker/);
  blocked.close();

  recordLease.run(otherWriter, 0);
  db.close();
  const writer = new HistoryPersistenceDatabase(dbPath);
  writer.durabilityBarrier(lease);
  writer.close();
});
