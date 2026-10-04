import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { PersistenceDirtyMarker, persistenceDirtyMarkerPath } from './persistenceDirtyMarker.js';

test('a dirty marker left by a dead process reports unflushed work, and a cleared one reports none', (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'dirty-marker-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const path = persistenceDirtyMarkerPath(dir);

  new PersistenceDirtyMarker(path, 4242, () => false).markDirty();
  const recovery = new PersistenceDirtyMarker(path, 99, () => false).recovery();
  assert.equal(recovery.durable, false);
  assert.equal(recovery.hadUnflushedWork, true);
  assert.match(recovery.message ?? '', /unflushed history/);

  const marker = new PersistenceDirtyMarker(path, 7, () => false);
  marker.markDirty();
  marker.markClean();
  assert.deepEqual(new PersistenceDirtyMarker(path, 8, () => false).recovery(), {
    durable: true,
    hadUnflushedWork: false,
  });
});
