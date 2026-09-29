import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

import { setDroidProxyAccountEnabled } from './droidProxy.js';

test('account toggle preserves credentials and file permissions', () => {
  const dir = mkdtempSync(join(tmpdir(), 'droidproxy-account-'));
  try {
    const first = join(dir, 'codex-first.json');
    writeFileSync(
      first,
      JSON.stringify({ type: 'codex', email: 'first@example.test', token: 'secret' }),
      {
        mode: 0o600,
      },
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
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('account toggle keeps one enabled account and rejects another provider', () => {
  const dir = mkdtempSync(join(tmpdir(), 'droidproxy-account-'));
  try {
    const path = join(dir, 'codex-only.json');
    writeFileSync(path, JSON.stringify({ type: 'codex', token: 'secret' }));
    assert.throws(
      () => setDroidProxyAccountEnabled('codex', 'codex-only.json', false, dir),
      /Keep at least one account enabled/,
    );
    assert.throws(
      () => setDroidProxyAccountEnabled('claude', 'codex-only.json', true, dir),
      /This account changed/,
    );
    assert.equal(JSON.parse(readFileSync(path, 'utf8')).disabled, undefined);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('account toggle rejects path traversal and symlinked auth files', () => {
  const dir = mkdtempSync(join(tmpdir(), 'droidproxy-account-'));
  try {
    const target = join(dir, 'target.json');
    writeFileSync(target, JSON.stringify({ type: 'codex' }));
    symlinkSync(target, join(dir, 'linked.json'));
    assert.throws(
      () => setDroidProxyAccountEnabled('codex', '../target.json', true, dir),
      /Invalid DroidProxy account/,
    );
    assert.throws(
      () => setDroidProxyAccountEnabled('codex', 'linked.json', true, dir),
      /regular auth file/,
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
