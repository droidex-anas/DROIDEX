import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  realpath,
  rm,
  symlink,
  truncate,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { AutomationAttachments } from './automationAttachments.js';
import { createAutomationRecord, normalizeAutomationInput } from './automationInput.js';
import { emptyAutomationStore } from './automationStore.js';

test('Electron tmp paths allow only macOS system aliases, not arbitrary symlink parents', async () => {
  const temporary = await mkdtemp(join(tmpdir(), 'scheduled-attachments-'));
  const directory = await realpath(temporary);
  const attachments = new AutomationAttachments(directory);
  try {
    const source = join(temporary, 'pasted.txt');
    await writeFile(source, 'Electron paste');
    const saved = await attachments.snapshot([source]);
    assert.ok(saved[0]);
    assert.equal(await readFile(saved[0], 'utf8'), 'Electron paste');
    const link = join(directory, 'escape');
    await symlink(directory, link);
    await assert.rejects(attachments.snapshot([join(link, 'pasted.txt')]), /symlink directories/);
    await assert.rejects(attachments.snapshot([`${directory}/../pasted.txt`]), /traversal/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('global 512 MiB budget includes recovered snapshots, permits references, and reclaims orphans', async () => {
  const directory = await realpath(await mkdtemp(join(tmpdir(), 'attachment-budget-')));
  const root = join(directory, 'automation-attachments');
  const store = emptyAutomationStore();
  try {
    await mkdir(root);
    // Sparse fixtures exercise the actual byte budget without allocating 510 MiB.
    for (let index = 0; index < 6; index += 1) {
      const path = join(root, `${randomUUID()}--large.txt`);
      await writeFile(path, '');
      await truncate(path, 85 * 1024 * 1024);
      store.automations.push(
        createAutomationRecord(
          normalizeAutomationInput({
            title: `Stored ${index}`,
            prompt: '',
            files: [path],
            target: { kind: 'existing-session', appSessionId: 'target' },
            enabled: false,
            schedule: { kind: 'once', runAt: 2_000 },
            timezone: 'UTC',
          }),
          1_000,
        ),
      );
    }
    const attachments = new AutomationAttachments(directory);
    await attachments.collect(store);
    const existing = store.automations[0]?.files;
    assert.ok(existing);
    assert.deepEqual(await attachments.snapshot(existing), existing);
    const source = join(directory, 'extra.txt');
    await writeFile(source, '');
    await truncate(source, 3 * 1024 * 1024);
    await assert.rejects(attachments.snapshot([source]), /512 MiB/);
    assert.equal((await readdir(root)).length, 6);
    await truncate(source, 2 * 1024 * 1024);
    assert.equal((await attachments.snapshot([source])).length, 1);
    await assert.rejects(attachments.snapshot([source]), /512 MiB/);
    await attachments.collect(store);
    assert.equal((await readdir(root)).length, 6);
    assert.equal((await attachments.snapshot([source])).length, 1);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('startup collection removes crash orphans but never unrelated files or symlinks', async () => {
  const directory = await realpath(await mkdtemp(join(tmpdir(), 'attachment-orphans-')));
  const root = join(directory, 'automation-attachments');
  try {
    await mkdir(root);
    const source = join(directory, 'source.txt');
    await writeFile(source, 'keep');
    const orphan = join(root, `${randomUUID()}--orphan.txt`);
    const link = join(root, `${randomUUID()}--link.txt`);
    await writeFile(orphan, 'crash orphan');
    await writeFile(join(root, 'unrelated.txt'), 'keep');
    await symlink(source, link);
    await new AutomationAttachments(directory).collect(emptyAutomationStore());
    await assert.rejects(readFile(orphan), { code: 'ENOENT' });
    assert.equal(await readFile(link, 'utf8'), 'keep');
    assert.equal(await readFile(join(root, 'unrelated.txt'), 'utf8'), 'keep');
    assert.equal(await readFile(source, 'utf8'), 'keep');
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
