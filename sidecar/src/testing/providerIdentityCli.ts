import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { TestContext } from 'node:test';

// Answers only the launch and turn protocols, leaving identity and event mapping to the adapters.
const cli = String.raw`#!/usr/bin/env node
import { randomUUID } from 'node:crypto';
import { createInterface } from 'node:readline';
const send = (message) => process.stdout.write(JSON.stringify(message) + '\n');
const codex = process.argv[2] === 'app-server';
let threadId;
createInterface({ input: process.stdin }).on('line', (line) => {
  const message = JSON.parse(line);
  if (!codex) {
    if (message.type === 'control_request') {
      send({ type: 'control_response', response: {
        subtype: 'success', request_id: message.request_id, response: { models: [], commands: [] },
      } });
    } else if (message.type === 'user') {
      send({ type: 'assistant', uuid: randomUUID(), session_id: message.session_id,
        parent_tool_use_id: null, message: { id: randomUUID(), role: 'assistant',
          content: [{ type: 'text', text: 'Mapped reply.' }] } });
      send({ type: 'result', subtype: 'success', is_error: false,
        user_message_uuid: message.uuid, session_id: message.session_id, result: 'Mapped reply.',
        usage: { input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 }, modelUsage: {}, permission_denials: [] });
    }
    return;
  }
  if (message.id === undefined) return;
  let result = { data: [], nextCursor: null };
  if (message.method === 'thread/start' || message.method === 'thread/resume') {
    threadId = message.params.threadId ?? 'codex-backend-thread';
    result = { thread: { id: threadId }, model: 'test-model' };
  }
  if (message.method === 'plugin/installed') result = { marketplaces: [] };
  if (message.method === 'turn/start') result = { turn: { id: 'turn', status: 'inProgress' } };
  send({ id: message.id, result });
  if (message.method === 'turn/start') {
    send({ method: 'turn/started', params: { threadId, turn: { id: 'turn', status: 'inProgress' } } });
    send({ method: 'item/agentMessage/delta', params: {
      threadId, turnId: 'turn', itemId: 'answer', delta: 'Mapped reply.',
    } });
    send({ method: 'turn/completed', params: { threadId, turn: { id: 'turn', status: 'completed' } } });
  }
});
`;

export async function providerIdentityCli(t: TestContext) {
  const cwd = await mkdtemp(join(tmpdir(), 'provider-identity-'));
  const executable = join(cwd, 'cli.mjs');
  await writeFile(executable, cli, { mode: 0o755 });
  t.after(() => rm(cwd, { recursive: true, force: true }));
  return { cwd, executable };
}
