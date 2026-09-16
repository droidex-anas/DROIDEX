import { strict as assert } from 'node:assert';
import { mkdtemp, mkdir, writeFile, symlink, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { listWorkspaceFiles, readWorkspaceFile } from './workspaceFiles.js';

test('file browsing pages real entries and rejects traversal, credentials, symlinks and binary data', async (context) => {
  const root = await mkdtemp(join(tmpdir(), 'droidex-files-'));
  context.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(join(root, 'src'));
  await mkdir(join(root, 'node_modules'));
  await writeFile(join(root, '.env'), 'secret');
  await writeFile(join(root, 'src', 'hello.swift'), 'print("Hello")');
  await writeFile(join(root, 'binary'), Buffer.from([1, 0, 3]));
  await symlink(tmpdir(), join(root, 'outside'));
  for (let i = 0; i < 105; i++) await writeFile(join(root, `item-${String(i).padStart(3, '0')}`), '');
  const first = await listWorkspaceFiles(root, '', undefined);
  assert.equal(first.entries.length, 100);
  assert.ok(first.nextCursor);
  const second = await listWorkspaceFiles(root, '', first.nextCursor);
  assert.equal(new Set([...first.entries, ...second.entries].map((entry) => entry.path)).size, 107);
  assert.ok(!first.entries.some((entry) => ['.env', 'node_modules', 'outside'].includes(entry.name)));
  assert.equal((await readWorkspaceFile(root, 'src/hello.swift')).text, 'print("Hello")');
  for (const name of ['../outside', '/etc/passwd', '.env', 'outside/test', 'src/../.env', 'src\\hello.swift']) {
    await assert.rejects(readWorkspaceFile(root, name));
  }
  await assert.rejects(readWorkspaceFile(root, 'binary'), /text|binary/i);
  await writeFile(join(root, 'large'), 'a'.repeat(70_000));
  const large = await readWorkspaceFile(root, 'large');
  assert.equal(large.truncated, true);
  assert.equal(large.text.length, 65_536);
});
