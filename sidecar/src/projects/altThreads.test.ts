import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createSdkMcpServer } from '@factory/droid-sdk';
import { harness, summary } from '../testing/projectServiceHarness.js';
import { registerProjectService } from './service.js';
import { threadTools } from './threadMcpTools.js';

test('Alt thread requests fail closed unless explicitly enabled locally', async (t) => {
  const previous = process.env.DROIDEX_ALT_HOME;
  delete process.env.DROIDEX_ALT_HOME;
  t.after(() => {
    if (previous === undefined) delete process.env.DROIDEX_ALT_HOME;
    else process.env.DROIDEX_ALT_HOME = previous;
  });
  const h = await harness(t);
  h.sessions.set('lead', summary('lead'));
  registerProjectService(Promise.resolve(h.projects));
  const tool = threadTools(() => 'lead').find((entry) => entry.name === 'thread_spawn');
  assert.ok(tool);
  const server = createSdkMcpServer({ name: 'alt-test', version: '1', tools: [tool] });
  const config = await server.start();
  t.after(() => server.close());
  assert.ok('url' in config);
  const response = await fetch(config.url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/call',
      params: {
        name: 'thread_spawn',
        arguments: { title: 'Alt task', prompt: 'Read files', reportBack: true, profile: 'alt' },
      },
    }),
  });
  assert.match(await response.text(), /profile/);
  assert.equal(h.launched.length, 0);
});

test('a queued Alt thread persists its profile and nested threads inherit it', async (t) => {
  const home = await mkdtemp(join(tmpdir(), 'droidex-alt-thread-'));
  const previous = process.env.DROIDEX_ALT_HOME;
  process.env.DROIDEX_ALT_HOME = home;
  await mkdir(join(home, '.factory'));
  await writeFile(join(home, '.factory', 'auth.v2.key'), 'test-login-marker');
  t.after(async () => {
    if (previous === undefined) delete process.env.DROIDEX_ALT_HOME;
    else process.env.DROIDEX_ALT_HOME = previous;
    await rm(home, { recursive: true, force: true });
  });
  const h = await harness(t);
  h.sessions.set('lead', summary('lead'));
  h.state.capacity = 'busy';
  const spawned = await h.projects.spawn('lead', {
    title: 'Alt task',
    prompt: 'Read files',
    profile: 'alt',
  });
  assert.equal(
    h.state.saved[0]?.threads.find((thread) => thread.appSessionId === spawned.appSessionId)
      ?.queuedSpawn?.input.droidProfile,
    'alt',
  );
  assert.equal(h.projects.read('lead', spawned.appSessionId).droidProfile, 'alt');
  assert.equal(
    h.projects.list()[0]?.threads.find((thread) => thread.appSessionId === spawned.appSessionId)
      ?.droidProfile,
    'alt',
  );
  h.sessions.set(spawned.appSessionId, { ...summary(spawned.appSessionId), droidProfile: 'alt' });
  await h.projects.spawn(spawned.appSessionId, { title: 'Nested', prompt: 'Read files' });
  const nested = h.state.saved[0]?.threads.find((thread) => thread.title === 'Nested');
  assert.equal(nested?.queuedSpawn?.input.droidProfile, 'alt');
  await h.projects.spawn(spawned.appSessionId, {
    title: 'Main task',
    prompt: 'Read files',
    profile: 'main',
  });
  const main = h.state.saved[0]?.threads.find((thread) => thread.title === 'Main task');
  assert.equal(main?.queuedSpawn?.input.droidProfile, undefined);
});
