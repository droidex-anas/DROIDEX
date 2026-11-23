import assert from 'node:assert/strict';
import test from 'node:test';
import type { SDKCommandsChangedMessage, SlashCommand } from '@anthropic-ai/claude-agent-sdk';

import { ClaudeCatalog } from './claudeCatalog.js';

const commandsChanged: SDKCommandsChangedMessage = {
  type: 'system',
  subtype: 'commands_changed',
  commands: [],
  uuid: '00000000-0000-0000-0000-000000000001',
  session_id: 'session',
};
const command = (name: string): SlashCommand => ({ name, description: name, argumentHint: '' });
const catalogNames = async (catalog: ClaudeCatalog) =>
  (await catalog.catalogItems()).map((item) => item.name);

test('Claude catalog recovers from initial and later fetch failures', async (t) => {
  const failure = new Error('transient control request failure');
  const responses = [failure, [command('recovered')], failure, []];
  const catalog = new ClaudeCatalog({
    supportedCommands: async () => {
      const response = responses.shift();
      assert.ok(response);
      if (response instanceof Error) throw response;
      return response;
    },
  });
  t.after(() => catalog.close());
  t.mock.method(console, 'warn', () => undefined);
  const updates: string[][] = [];
  catalog.onUpdated((items) => updates.push(items.map((item) => item.name)));

  await assert.rejects(catalog.catalogItems(), failure);
  catalog.observe(commandsChanged);
  assert.deepEqual(await catalogNames(catalog), ['recovered']);
  assert.deepEqual(await catalogNames(catalog), ['recovered']);

  catalog.observe({
    type: 'system',
    subtype: 'init',
    apiKeySource: 'none',
    claude_code_version: 'test',
    cwd: '/unused',
    tools: [],
    mcp_servers: [],
    model: 'test',
    permissionMode: 'default',
    slash_commands: ['recovered'],
    output_style: 'default',
    skills: ['recovered'],
    plugins: [],
    uuid: '00000000-0000-0000-0000-000000000002',
    session_id: 'session',
  });
  assert.deepEqual(
    (await catalog.catalogItems()).map((item) => item.kind),
    ['skill'],
  );

  catalog.observe(commandsChanged);
  assert.deepEqual(await catalogNames(catalog), ['recovered']);
  catalog.observe(commandsChanged);
  assert.deepEqual(await catalog.catalogItems(), []);
  assert.deepEqual(await catalog.catalogItems(), []);
  assert.deepEqual(updates, [['recovered'], ['recovered'], []]);
});

test('Claude catalog queues refreshes behind initialization and each other', async (t) => {
  const requests: Array<{
    resolve: (commands: SlashCommand[]) => void;
    reject: (error: Error) => void;
  }> = [];
  const catalog = new ClaudeCatalog({
    supportedCommands: () => new Promise((resolve, reject) => requests.push({ resolve, reject })),
  });
  t.after(() => catalog.close());
  const updates: string[][] = [];
  catalog.onUpdated((items) => updates.push(items.map((item) => item.name)));
  const initial = catalog.catalogItems();
  const rejected = assert.rejects(initial, /initial failure/);
  await Promise.resolve();
  catalog.observe(commandsChanged);
  catalog.observe(commandsChanged);
  assert.equal(requests.length, 1);
  requests[0].reject(new Error('initial failure'));
  await rejected;
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(requests.length, 2);
  requests[1].resolve([command('first')]);
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(requests.length, 3);
  requests[2].resolve([command('second')]);
  assert.deepEqual(await catalogNames(catalog), ['second']);
  assert.deepEqual(updates, [['first'], ['second']]);
});
