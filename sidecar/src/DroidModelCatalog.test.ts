import assert from 'node:assert/strict';
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { DroidModelCatalog } from './DroidModelCatalog.js';

test('settings change invalidates a live session catalog', async () => {
  const home = mkdtempSync(join(tmpdir(), 'droid-model-catalog-'));
  const previousHome = process.env.HOME;
  process.env.HOME = home;
  try {
    const droidPath = join(home, 'droid');
    writeFileSync(droidPath, '#!/bin/sh\nprintf "Custom Models:\\n  custom:new  New model\\n"\n');
    chmodSync(droidPath, 0o700);
    const catalog = new DroidModelCatalog(() => droidPath);
    catalog.adoptSession([{ id: 'custom:old', displayName: 'Old model' }]);
    assert.deepEqual(
      (await catalog.readHelp()).map((model) => model.id),
      ['custom:old'],
    );

    catalog.invalidate();
    assert.deepEqual(
      (await catalog.readHelp()).map((model) => model.id),
      ['custom:new'],
    );
  } finally {
    if (previousHome === undefined) delete process.env.HOME;
    else process.env.HOME = previousHome;
    rmSync(home, { recursive: true, force: true });
  }
});
