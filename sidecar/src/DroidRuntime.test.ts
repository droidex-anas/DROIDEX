import test from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DroidRuntime, createInitializeSessionParams } from './DroidRuntime.js';
import { HistoryIndex } from './history.js';
import { FakeFactorySession } from './testing/fakeFactoryRuntime.js';
import { DroidProviderSession } from './providers/droid/DroidProviderSession.js';
import type { DroidStreamEvent } from '@factory/droid-sdk';

// Answers every request the way Droid answers load_session for a session it
// will not open.
const SESSION_NOT_FOUND_DAEMON = `
require('node:readline').createInterface({ input: process.stdin }).on('line', (line) => {
  const request = JSON.parse(line);
  process.stdout.write(JSON.stringify({
    jsonrpc: request.jsonrpc,
    factoryApiVersion: request.factoryApiVersion,
    type: 'response',
    id: request.id,
    error: { code: -32004, message: 'Session not found' },
  }) + '\\n');
});
`;

// Settings writes release the late loop; interrupts deliberately emit no idle
// notice, as Droid does when it is already idle with an undelivered command.
const STEER_DAEMON = `
const write = (value) => process.stdout.write(JSON.stringify(value) + '\\n');
const notify = (notification) => write({
  jsonrpc: '2.0', factoryApiVersion: '1.0.0', type: 'notification',
  method: 'droid.session_notification', params: { notification },
});
const state = (newState) => notify({ type: 'droid_working_state_changed', newState });
const text = (textDelta) => notify({ type: 'assistant_text_delta', messageId: 'answer', blockIndex: 0, textDelta });
require('node:readline').createInterface({ input: process.stdin }).on('line', (line) => {
  const request = JSON.parse(line);
  const envelope = {
    jsonrpc: request.jsonrpc, factoryApiVersion: request.factoryApiVersion,
    type: 'response', id: request.id,
  };
  const reply = (result) => write({ ...envelope, result });
  if (request.method === 'droid.initialize_session') {
    reply({ sessionId: 'steer-session', session: {}, settings: { modelId: 'test-model', reasoningEffort: 'medium' } });
  } else if (request.method === 'droid.add_user_message') {
    const { text: prompt, messageId } = request.params;
    if (request.params.queuePlacement !== undefined) throw new Error('steer must use default queue placement');
    if (prompt === 'reject') {
      state('idle');
      write({ ...envelope, error: { code: -32603, message: 'steer rejected' } });
      return;
    }
    reply({});
    if (!messageId) {
      state('streaming_assistant_message');
      text('main');
      return;
    }
    state('idle');
    if (prompt === 'held') return;
    if (prompt === 'discard') {
      notify({ type: 'queued_messages_discarded', text: prompt });
      return;
    }
    state('streaming_assistant_message');
    notify({
      type: 'create_message',
      message: {
        id: messageId, role: 'user', createdAt: 0, updatedAt: 0,
        content: [{ type: 'text', text: prompt }],
      },
    });
    notify({ type: 'tool_call', toolUse: { type: 'tool_use', id: 'task', name: 'Task', input: {} } });
    notify({ type: 'tool_result', messageId: 'tool-message', toolUseId: 'task', content: 'done', isError: false });
    text('tail');
  } else if (request.method === 'droid.update_session_settings') {
    state('idle');
    reply({});
  } else {
    reply({});
  }
});
`;

test('a late Droid steer keeps the turn open through its loop and releases on drop, Stop, or close', async (t) => {
  if (process.platform === 'win32') return t.skip('the fake daemon is a shebang script');
  const dir = mkdtempSync(join(tmpdir(), 'droid-runtime-steer-'));
  const previousPath = process.env.DROID_PATH;
  const daemon = join(dir, 'droid');
  writeFileSync(daemon, `#!${process.execPath}\n${STEER_DAEMON}`);
  chmodSync(daemon, 0o755);
  process.env.DROID_PATH = daemon;
  const runtime = new DroidRuntime();
  const droid = await runtime.createSession({ cwd: dir, interactionMode: 'auto' });
  const provider = new DroidProviderSession('app-session', droid, runtime);
  const events: DroidStreamEvent[] = [];
  const start = () => runtime.streamTurn(droid, 'main', { includePartialMessages: true });
  try {
    const stream = start();
    // Reading manually avoids closing the iterator at this controlled boundary.
    const readText = async (text: string) => {
      while (true) {
        const next = await stream.next();
        assert.equal(next.done, false);
        if (next.done) return;
        events.push(next.value);
        assert.notEqual(next.value.type, 'result');
        if (next.value.type === 'assistant_text_delta' && next.value.text === text) return;
      }
    };
    await readText('main');
    assert.equal(await runtime.steer(droid, 'late'), true);
    await readText('tail');
    assert.equal(events.filter((event) => event.type === 'user').length, 1);
    assert.ok(events.some((event) => event.type === 'tool_result' && event.toolName === 'Task'));
    await droid.updateSettings({ modelId: 'test-model' });
    for await (const event of stream) events.push(event);
    assert.equal(events.filter((event) => event.type === 'result').length, 1);
    assert.equal(events.at(-1)?.type, 'result');
    assert.equal(await runtime.steer(droid, 'after settlement'), false);

    for (const ending of ['reject', 'discard', 'stop', 'close'] as const) {
      const waiting = start();
      let first = await waiting.next();
      while (first.value?.type !== 'assistant_text_delta') {
        assert.equal(first.done, false);
        first = await waiting.next();
      }
      assert.equal(await runtime.steer(droid, '  /command'), false);
      const pending = runtime.steer(
        droid,
        ending === 'stop' || ending === 'close' ? 'held' : ending,
      );
      if (ending === 'reject') await assert.rejects(pending, /steer rejected/);
      else if (ending === 'discard') assert.equal(await pending, false);
      else {
        // The main idle arrives before this read. The tail has no more notices.
        assert.equal((await waiting.next()).value?.type, 'working_state_changed');
        const tail = waiting.next();
        if (ending === 'stop') await provider.interrupt();
        else await provider.close();
        assert.equal(await pending, false);
        assert.equal((await tail).value?.type, 'result');
      }
      for await (const event of waiting)
        assert.ok(event.type === 'working_state_changed' || event.type === 'result');
    }
  } finally {
    await provider.close();
    if (previousPath === undefined) delete process.env.DROID_PATH;
    else process.env.DROID_PATH = previousPath;
    rmSync(dir, { recursive: true, force: true });
  }
});

test('names the owning organization when Droid refuses a session file it has on disk', async (t) => {
  if (process.platform === 'win32') return t.skip('the fake daemon is a shebang script');
  const dir = mkdtempSync(join(tmpdir(), 'droid-runtime-org-'));
  const previous = {
    droidPath: process.env.DROID_PATH,
    historyDir: process.env.DROIDEX_HISTORY_DIR,
  };
  const daemon = join(dir, 'droid');
  writeFileSync(daemon, `#!${process.execPath}\n${SESSION_NOT_FOUND_DAEMON}`);
  chmodSync(daemon, 0o755);
  process.env.DROID_PATH = daemon;
  process.env.DROIDEX_HISTORY_DIR = join(dir, 'history');
  const sessionPath = join(dir, 'other-org.jsonl');
  writeFileSync(
    sessionPath,
    `${JSON.stringify({ type: 'session_start', id: 'other-org', organizationId: 'org-before' })}\n`,
  );
  const index = new HistoryIndex();
  try {
    index.applySessionFileReconciliation({
      previousRevision: 0,
      revision: 1,
      changed: 1,
      upserts: [
        {
          providerSessionId: 'other-org',
          path: sessionPath,
          birthtimeMs: 1,
          mtimeMs: 1,
          sizeBytes: 1,
          settingsMtimeMs: null,
          summary: null,
        },
      ],
      removedProviderSessionIds: [],
    });

    await assert.rejects(new DroidRuntime().loadSession('other-org'), /organization org-before/);
    await assert.rejects(new DroidRuntime().loadSession('not-on-disk'), {
      message: 'Session not found: not-on-disk',
    });
  } finally {
    index.close();
    for (const [key, value] of [
      ['DROID_PATH', previous.droidPath],
      ['DROIDEX_HISTORY_DIR', previous.historyDir],
    ] as const) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    rmSync(dir, { recursive: true, force: true });
  }
});

test('passes compaction settings, including the current-model sentinel, when initializing a session', () => {
  const params = createInitializeSessionParams({
    cwd: '/tmp/project',
    interactionMode: 'auto',
    modelId: 'main-model',
    compactionModel: 'summary-model',
    compactionTokenLimit: 400_000,
  });

  assert.equal(params.compactionModel, 'summary-model');
  assert.equal(params.compactionTokenLimit, 400_000);

  const sentinel = createInitializeSessionParams({
    cwd: '/tmp/project',
    interactionMode: 'auto',
    modelId: 'main-model',
    compactionModel: 'current-model',
  });
  assert.equal(sentinel.compactionModel, 'current-model');
});

test('edits-only uses native Off so commands still reach the permission callback', () => {
  for (const [autonomyLevel, expected] of [
    ['off', 'off'],
    ['low', 'off'],
    ['medium', 'medium'],
    ['high', 'high'],
  ] as const) {
    const params = createInitializeSessionParams({
      cwd: '/tmp/project',
      interactionMode: 'auto',
      autonomyLevel,
    });
    assert.equal(params.autonomyLevel, expected);
  }
});

test('readContextBreakdown tries the public seam, then the private RPC, best effort', async () => {
  const session = new FakeFactorySession('backend', {}, []);
  const runtime = new DroidRuntime();
  Reflect.set(session, 'getContextBreakdown', () => Promise.resolve({ usedTokens: 10 }));
  assert.deepEqual(await runtime.readContextBreakdown(session), { usedTokens: 10 });

  Reflect.deleteProperty(session, 'getContextBreakdown');
  let rpcMethod = '';
  Reflect.set(session, '_client', {
    _sessionRpcWithoutParams: (method: string) => {
      rpcMethod = method;
      return Promise.resolve({ freeTokens: 90 });
    },
  });
  assert.deepEqual(await runtime.readContextBreakdown(session), { freeTokens: 90 });
  assert.equal(rpcMethod, 'droid.get_context_breakdown');

  Reflect.set(session, '_client', {
    _sessionRpcWithoutParams: () => Promise.reject(new Error('transport closed')),
  });
  assert.equal(await runtime.readContextBreakdown(session), undefined);
});
