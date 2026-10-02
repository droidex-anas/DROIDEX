import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test, type TestContext } from 'node:test';

import { setDroidProxyAccountEnabled } from './droidProxy.js';

function authDir(t: TestContext): string {
  const dir = mkdtempSync(join(tmpdir(), 'droidproxy-account-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

test('account toggle preserves credentials and file permissions', (t) => {
  const dir = authDir(t);
  const first = join(dir, 'codex-first.json');
  writeFileSync(
    first,
    JSON.stringify({ type: 'codex', email: 'first@example.test', token: 'secret' }),
    { mode: 0o600 },
  );
  writeFileSync(join(dir, 'codex-second.json'), JSON.stringify({ type: 'codex' }));

  setDroidProxyAccountEnabled('codex', 'codex-first.json', false, dir);
  assert.deepEqual(JSON.parse(readFileSync(first, 'utf8')), {
    type: 'codex',
    email: 'first@example.test',
    token: 'secret',
    disabled: true,
  });
  assert.equal(statSync(first).mode & 0o777, 0o600);

  setDroidProxyAccountEnabled('codex', 'codex-first.json', true, dir);
  assert.equal(JSON.parse(readFileSync(first, 'utf8')).disabled, false);
});

test('account toggle refuses the last enabled account, another provider, traversal and symlinks', (t) => {
  const dir = authDir(t);
  const path = join(dir, 'codex-only.json');
  writeFileSync(path, JSON.stringify({ type: 'codex', token: 'secret' }));
  symlinkSync(path, join(dir, 'linked.json'));
  const refusals = [
    ['codex', 'codex-only.json', false, /Keep at least one account enabled/],
    ['claude', 'codex-only.json', true, /This account changed/],
    ['codex', '../codex-only.json', true, /Invalid DroidProxy account/],
    ['codex', 'linked.json', true, /regular auth file/],
  ] as const;
  for (const [provider, file, enabled, error] of refusals) {
    assert.throws(() => setDroidProxyAccountEnabled(provider, file, enabled, dir), error);
  }
  assert.equal(JSON.parse(readFileSync(path, 'utf8')).disabled, undefined);
});
