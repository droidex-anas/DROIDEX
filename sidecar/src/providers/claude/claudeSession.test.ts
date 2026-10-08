import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { ClaudeSession } from './claudeSession.js';

// Speak the SDK control protocol without launching an authenticated CLI or a turn.
const fakeCli = String.raw`#!/usr/bin/env node
import { appendFileSync, writeFileSync } from 'node:fs';
import { createInterface } from 'node:readline';
writeFileSync('launch.json', JSON.stringify(process.argv.slice(2)));
createInterface({ input: process.stdin }).on('line', (line) => {
  const message = JSON.parse(line);
  if (message.type !== 'control_request') return;
  appendFileSync('controls.jsonl', JSON.stringify(message.request) + '\n');
  process.stdout.write(JSON.stringify({ type: 'control_response', response: {
    subtype: 'success', request_id: message.request_id, response: { models: [], commands: [] },
  } }) + '\n');
});
`;

const steerCli = String.raw`#!/usr/bin/env node
import { createInterface } from 'node:readline';
const cancellations = [];
let waitingForCancellation;
const reply = (message, response = {}) => process.stdout.write(JSON.stringify({
  type: 'control_response', response: {
    subtype: 'success', request_id: message.request_id, response,
  },
}) + '\n');
createInterface({ input: process.stdin }).on('line', (line) => {
  const message = JSON.parse(line);
  if (message.type === 'user' && message.message.content === 'first') {
    process.stdout.write(JSON.stringify({
      type: 'assistant', uuid: 'answer', session_id: message.session_id,
      parent_tool_use_id: null,
      message: { id: 'answer', role: 'assistant', content: [{ type: 'text', text: 'Ready' }] },
    }) + '\n');
    return;
  }
  if (message.type !== 'control_request') return;
  const request = message.request;
  if (request.subtype === 'cancel_async_message') {
    cancellations.push(message);
    if (waitingForCancellation) reply(waitingForCancellation);
    return;
  }
  if (request.subtype === 'set_model' && request.model === 'wait-for-cancellation') {
    if (cancellations.length) reply(message);
    else waitingForCancellation = message;
    return;
  }
  if (request.subtype === 'set_model' && request.model === 'release-cancellation') {
    // Only the last overlapping request successfully withdraws the prompt.
    cancellations.forEach((pending, index) => reply(pending, {
      cancelled: index === cancellations.length - 1,
    }));
  }
  if (request.subtype === 'set_model' && request.model === 'confirm-withdrawal') {
    process.stdout.write(JSON.stringify({
      type: 'command_lifecycle', state: 'cancelled',
      command_uuid: cancellations[0].request.message_uuid,
    }) + '\n');
  }
  reply(message, { models: [], commands: [] });
});
`;

for (const fastMode of [undefined, true]) {
  test(`Claude starts fast mode ${String(fastMode ?? false)} and applies live on/off without changing effort`, async () => {
    const directory = mkdtempSync(join(tmpdir(), 'claude-fast-mode-'));
    const executable = join(directory, 'fake-cli.mjs');
    writeFileSync(executable, fakeCli);
    chmodSync(executable, 0o755);
    const session = new ClaudeSession({
      appSessionId: randomUUID(),
      executable,
      cwd: directory,
      autonomy: 'low',
      interactionMode: 'auto',
      reasoningEffort: 'ultra',
      fastMode,
      models: [],
      mcpServers: {},
      interactions: {
        requestApproval: () => Promise.reject(new Error('unused')),
        requestQuestion: () => Promise.reject(new Error('unused')),
        isActive: () => true,
        cancelPending: () => undefined,
      },
    });
    try {
      await session.start();
      await session.setModel({ fastMode: true });
      await session.setModel({ fastMode: false });
      const args: string[] = JSON.parse(readFileSync(join(directory, 'launch.json'), 'utf8'));
      assert.deepEqual(JSON.parse(args[args.indexOf('--settings') + 1]), {
        ultracode: true,
        fastMode: fastMode ?? false,
      });
      const controls: { subtype: string; settings?: unknown }[] = readFileSync(
        join(directory, 'controls.jsonl'),
        'utf8',
      )
        .trim()
        .split('\n')
        .map((line) => JSON.parse(line));
      assert.deepEqual(
        controls.filter((request) => request.subtype === 'apply_flag_settings'),
        [
          { subtype: 'apply_flag_settings', settings: { fastMode: true } },
          { subtype: 'apply_flag_settings', settings: { fastMode: false } },
        ],
      );
    } finally {
      await session.close();
      rmSync(directory, { recursive: true, force: true });
    }
  });
}

test('a confirmed withdrawal wins over concurrent turn finalization', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'claude-steer-withdrawal-'));
  const executable = join(directory, 'fake-cli.mjs');
  writeFileSync(executable, steerCli);
  chmodSync(executable, 0o755);
  const session = new ClaudeSession({
    appSessionId: randomUUID(),
    executable,
    cwd: directory,
    autonomy: 'low',
    interactionMode: 'auto',
    models: [],
    mcpServers: {},
    interactions: {
      requestApproval: () => Promise.reject(new Error('unused')),
      requestQuestion: () => Promise.reject(new Error('unused')),
      isActive: () => true,
      cancelPending: () => undefined,
    },
  });
  try {
    const turn = session.stream('first');
    assert.equal((await turn.next()).value?.transcript?.text, 'Ready');
    const steerId = randomUUID();
    const delivery = session.steer('held', undefined, steerId);
    const ending = turn.return(undefined);
    await session.setModel({ modelId: 'wait-for-cancellation' });
    const withdrawing = session.withdrawSteer(steerId);
    await session.setModel({ modelId: 'release-cancellation' });

    assert.equal(await withdrawing, true);
    assert.equal(await delivery, 'withdrawn');
    await ending;
  } finally {
    await session.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test('a withdrawal re-ask waits for the shared cancellation receipt', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'claude-withdrawal-reask-'));
  const executable = join(directory, 'fake-cli.mjs');
  writeFileSync(executable, steerCli);
  chmodSync(executable, 0o755);
  const session = new ClaudeSession({
    appSessionId: randomUUID(),
    executable,
    cwd: directory,
    autonomy: 'low',
    interactionMode: 'auto',
    models: [],
    mcpServers: {},
    interactions: {
      requestApproval: () => Promise.reject(new Error('unused')),
      requestQuestion: () => Promise.reject(new Error('unused')),
      isActive: () => true,
      cancelPending: () => undefined,
    },
  });
  try {
    const turn = session.stream('first');
    await turn.next();
    const steerId = randomUUID();
    const delivery = session.steer('held', undefined, steerId);
    const withdrawing = session.withdrawSteer(steerId);
    await session.setModel({ modelId: 'wait-for-cancellation' });
    let reaskSettled = false;
    const reasking = session.withdrawSteer(steerId).then((outcome) => {
      reaskSettled = true;
      return outcome;
    });
    await session.setModel({ modelId: 'wait-for-cancellation' });
    assert.equal(reaskSettled, false);
    await session.setModel({ modelId: 'release-cancellation' });

    assert.deepEqual(await Promise.all([withdrawing, reasking]), [true, true]);
    assert.equal(await delivery, 'withdrawn');
    await turn.return(undefined);
  } finally {
    await session.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test('a lifecycle-confirmed withdrawal survives shutdown before its control reply', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'claude-withdrawal-shutdown-'));
  const executable = join(directory, 'fake-cli.mjs');
  writeFileSync(executable, steerCli);
  chmodSync(executable, 0o755);
  const session = new ClaudeSession({
    appSessionId: randomUUID(),
    executable,
    cwd: directory,
    autonomy: 'low',
    interactionMode: 'auto',
    models: [],
    mcpServers: {},
    interactions: {
      requestApproval: () => Promise.reject(new Error('unused')),
      requestQuestion: () => Promise.reject(new Error('unused')),
      isActive: () => true,
      cancelPending: () => undefined,
    },
  });
  try {
    const turn = session.stream('first');
    await turn.next();
    const steerId = randomUUID();
    const delivery = session.steer('held', undefined, steerId);
    const withdrawing = session.withdrawSteer(steerId);
    await session.setModel({ modelId: 'wait-for-cancellation' });
    await session.setModel({ modelId: 'confirm-withdrawal' });
    assert.equal(await delivery, 'withdrawn');
    await session.close();
    assert.equal(await withdrawing, true);
    await turn.return(undefined);
  } finally {
    await session.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
