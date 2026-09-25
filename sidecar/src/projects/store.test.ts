import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { ProjectStore, threadInputSchema } from './store.js';
import type { Project } from './types.js';

function project(): Project {
  return {
    id: 'project',
    title: 'Example',
    paused: false,
    launching: 0,
    plan: [],
    threads: [{ appSessionId: 'main', title: 'Main', reply: '', waiting: false }],
    pending: [],
  };
}

test('a missing ledger is empty, writes are ordered, and a fresh reader restores the last snapshot', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'droidex-projects-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const path = join(directory, 'projects.json');
  const store = new ProjectStore(path);
  assert.deepEqual(await store.load(), []);
  const first = project();
  const one = store.save([first]);
  first.title = 'Second';
  first.paused = true;
  first.leadStopped = true;
  const two = store.save([first]);
  await Promise.all([one, two]);
  const [loaded] = await new ProjectStore(path).load();
  assert.equal(loaded?.title, 'Second');
  // Why a project is held has to survive a restart, or the lead's spawn could not lift it.
  assert.equal(loaded?.leadStopped, true);
  if (process.platform !== 'win32') assert.equal((await stat(path)).mode & 0o777, 0o600);
});

test('corruption is reported without overwriting the user’s saved data', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'droidex-projects-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const path = join(directory, 'projects.json');
  const raw = '{broken';
  await writeFile(path, raw);
  await assert.rejects(new ProjectStore(path).load());
  assert.equal(await readFile(path, 'utf8'), raw);
});

test('unknown owners, duplicate identities, cycles and foreign message targets are rejected', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'droidex-projects-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const path = join(directory, 'projects.json');
  const store = new ProjectStore(path);
  const duplicate = project();
  await writeFile(path, JSON.stringify([duplicate, { ...duplicate, id: 'other' }]));
  await assert.rejects(store.load(), /multiple projects/);
  const unknown = project();
  unknown.threads.push({
    appSessionId: 'child',
    ownerAppSessionId: 'missing',
    title: 'Child',
    reply: '',
    waiting: false,
  });
  await writeFile(path, JSON.stringify([unknown]));
  await assert.rejects(store.load(), /ownership/);
  const cycle = project();
  cycle.threads.push({
    appSessionId: 'child',
    ownerAppSessionId: 'child',
    title: 'Child',
    reply: '',
    waiting: false,
  });
  await writeFile(path, JSON.stringify([cycle]));
  await assert.rejects(store.load(), /ownership/);
  const foreign = project();
  foreign.pending.push({
    id: 'message',
    from: 'main',
    to: 'other',
    kind: 'question',
    text: 'Question',
  });
  await writeFile(path, JSON.stringify([foreign]));
  await assert.rejects(store.load(), /target/);
});

test('a renderer command cannot name a thread owner', () => {
  const input = { title: 'Task', prompt: 'Work', provider: 'droid', autonomy: 'low' };
  assert.equal(
    threadInputSchema.safeParse({ ...input, ownerAppSessionId: 'spoofed' }).success,
    false,
  );
});
