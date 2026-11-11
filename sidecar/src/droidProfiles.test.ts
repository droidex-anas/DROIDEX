import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { droidHome } from './droidProfiles.js';

test('Alt 2 runs on its own login and refuses the one Alt uses', (t) => {
  const root = mkdtempSync(join(tmpdir(), 'droid-profiles-'));
  t.after(() => {
    delete process.env.DROIDEX_ALT_HOME;
    delete process.env.DROIDEX_ALT2_HOME;
    rmSync(root, { recursive: true, force: true });
  });
  const [alt, alt2] = ['alt', 'alt2'].map((name) => {
    const home = join(root, name);
    mkdirSync(join(home, '.factory'), { recursive: true });
    writeFileSync(join(home, '.factory', 'auth.v2.key'), name);
    return home;
  });
  process.env.DROIDEX_ALT_HOME = alt;
  process.env.DROIDEX_ALT2_HOME = alt2;
  assert.equal(droidHome('alt'), alt);
  assert.equal(droidHome('alt2'), alt2);

  process.env.DROIDEX_ALT2_HOME = alt;
  assert.throws(() => droidHome('alt2'), /Alt 2 home must use a separate Factory login/);
});
