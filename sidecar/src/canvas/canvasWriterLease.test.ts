import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';

import { CanvasWriterLease } from './canvasWriterLease.js';

test('a writer lease claimed before this boot does not keep Canvas storage locked', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'canvas-lease-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const held = await CanvasWriterLease.acquire(dir);
  t.after(() => held.release());
  await assert.rejects(CanvasWriterLease.acquire(dir), { code: 'storage_failed' });

  // The holder is this live process, standing in for an unrelated one that
  // reused the recorded id after a restart. The file itself was just written,
  // as SQLite's journal recovery would, so only the recorded claim time counts.
  const db = new DatabaseSync(join(dir, '.writer-lease.sqlite'));
  db.prepare('UPDATE writer_claim SET claimed_at_ms = 0').run();
  db.close();
  const reclaimed = await CanvasWriterLease.acquire(dir);
  reclaimed.release();
});
