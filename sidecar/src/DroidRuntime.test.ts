import test from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
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
const usage = (inputTokens, outputTokens) => notify({
  type: 'session_token_usage_changed', sessionId: 'steer-session', tokenUsage: {
    inputTokens, outputTokens, cacheReadTokens: 0, cacheCreationTokens: 0, thinkingTokens: 0,
  },
});
let heldMessage;
let heldReply;
const deliver = ({ messageId, prompt }) => {
  const message = () => notify({
    type: 'create_message',
    message: {
      id: messageId, role: 'user', createdAt: 0, updatedAt: 0,
      content: [{ type: 'text', text: prompt }],
    },
  });
  // Droid can show the message while still idle, a moment before its reply
  // loop starts.
  if (prompt === 'idle-gap') {
    message();
    setTimeout(() => deliver({ messageId: 'shown', prompt: 'reply' }), 50);
    return;
  }
  state('streaming_assistant_message');
  if (prompt !== 'reply') message();
  notify({ type: 'tool_result', messageId: 'tool-message', toolUseId: 'task', content: 'done', isError: false });
  text('tail');
  usage(20, 10);
};
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
    if (!messageId) {
      reply({});
      state('streaming_assistant_message');
      text('main');
      notify({ type: 'tool_call', toolUse: { type: 'tool_use', id: 'task', name: 'Task', input: {} } });
      usage(10, 5);
      return;
    }
    state('idle');
    if (prompt === 'held' || prompt === 'held-rpc') {
      heldMessage = { messageId, prompt };
      if (prompt === 'held-rpc') heldReply = reply;
      else reply({});
      return;
    }
    if (prompt === 'delivered-rejected') {
      deliver({ messageId, prompt });
      write({ ...envelope, error: { code: -32603, message: 'steer rejected after delivery' } });
      return;
    }
    reply({});
    if (prompt === 'discard') {
      notify({ type: 'queued_messages_discarded', text: prompt });
      return;
    }
    deliver({ messageId, prompt });
  } else if (request.method === 'droid.update_session_settings') {
    if (request.params.modelId === 'deliver-held') {
      deliver(heldMessage);
      heldMessage = undefined;
    } else {
      state('idle');
    }
    if (request.params.modelId === 'release-rpc') {
      heldReply?.({});
      heldReply = undefined;
    }
    reply({});
  } else {
    reply({});
  }
});
`;

test('isolates concurrent Alt launches and resumes without charging the Main API key', async (t) => {
  if (process.platform === 'win32') return t.skip('the fake daemon is a shebang script');
  const dir = mkdtempSync(join(tmpdir(), 'droid-runtime-profiles-'));
  const altHome = join(dir, 'alt');
  mkdirSync(join(altHome, '.factory'), { recursive: true });
  writeFileSync(join(altHome, '.factory', 'auth.v2.key'), 'test-login-marker');
  const daemon = join(dir, 'droid');
  writeFileSync(
    daemon,
    `#!${process.execPath}\n
const fs = require('node:fs');
require('node:readline').createInterface({ input: process.stdin }).on('line', (line) => {
  const request = JSON.parse(line);
  const launch = request.method === 'droid.initialize_session' || request.method === 'droid.load_session';
  if (launch) fs.appendFileSync('launches.jsonl', JSON.stringify({
    home: process.env.HOME, method: request.method,
    hasMainKey: process.env.FACTORY_API_KEY === 'test-main-key',
    leakedOptIn: process.env.DROIDEX_ALT_HOME !== undefined,
  }) + '\\n');
  const result = launch ? {
    sessionId: request.params.sessionId ?? 'profile-' + process.pid,
    session: {}, settings: { modelId: 'test-model', reasoningEffort: 'medium' },
  } : {};
  process.stdout.write(JSON.stringify({ jsonrpc: request.jsonrpc,
    factoryApiVersion: request.factoryApiVersion, type: 'response', id: request.id, result }) + '\\n');
});
`,
  );
  chmodSync(daemon, 0o755);
  const previous = {
    DROID_PATH: process.env.DROID_PATH,
    DROIDEX_ALT_HOME: process.env.DROIDEX_ALT_HOME,
    FACTORY_API_KEY: process.env.FACTORY_API_KEY,
  };
  process.env.DROID_PATH = daemon;
  process.env.DROIDEX_ALT_HOME = altHome;
  process.env.FACTORY_API_KEY = 'test-inherited-key';
  const mainHome = process.env.HOME;
  const runtime = new DroidRuntime();
  runtime.connect('test-main-key');
  const sessions: Awaited<ReturnType<DroidRuntime['createSession']>>[] = [];
  try {
    const [main, alt] = await Promise.all([
      runtime.createSession({ cwd: dir, interactionMode: 'auto' }),
      runtime.createSession({ cwd: dir, interactionMode: 'auto', droidProfile: 'alt' }),
    ]);
    sessions.push(main, alt);
    assert.equal(runtime.factoryApiKey(main), 'test-main-key');
    assert.equal(runtime.factoryApiKey(alt), undefined);
    sessions.push(await runtime.loadSession(alt.sessionId, { cwd: dir, droidProfile: 'alt' }));
    const launches = readFileSync(join(dir, 'launches.jsonl'), 'utf8')
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line));
    assert.deepEqual(
      launches.filter((launch) => launch.home === altHome),
      [
        {
          home: altHome,
          method: 'droid.initialize_session',
          hasMainKey: false,
          leakedOptIn: false,
        },
        { home: altHome, method: 'droid.load_session', hasMainKey: false, leakedOptIn: false },
      ],
    );
    assert.equal(launches.find((launch) => launch.home === mainHome)?.hasMainKey, true);
    assert.equal(process.env.HOME, mainHome);
    assert.equal(process.env.FACTORY_API_KEY, 'test-inherited-key');
  } finally {
    await Promise.all(sessions.map((session) => session.close()));
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    rmSync(dir, { recursive: true, force: true });
  }
});

test('Droid steer preserves delivery, tail completion, and interrupt ordering', async (t) => {
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
  const readUntil = async (
    stream: AsyncGenerator<DroidStreamEvent>,
    matches: (event: DroidStreamEvent) => boolean,
  ) => {
    while (true) {
      const next = await stream.next();
      assert.equal(next.done, false);
      if (next.done) return;
      events.push(next.value);
      assert.notEqual(next.value.type, 'result');
      if (matches(next.value)) return;
    }
  };
  const readText = (stream: AsyncGenerator<DroidStreamEvent>, text: string) =>
    readUntil(stream, (event) => event.type === 'assistant_text_delta' && event.text === text);
  const readIdle = (stream: AsyncGenerator<DroidStreamEvent>) =>
    readUntil(stream, (event) => event.type === 'working_state_changed' && event.state === 'idle');
  const finish = async (stream: AsyncGenerator<DroidStreamEvent>) => {
    await droid.updateSettings({ modelId: 'test-model' });
    for await (const event of stream) events.push(event);
  };
  try {
    await t.test(
      'buffers an early late loop and preserves main tool names and cumulative usage',
      async () => {
        const stream = start();
        await readText(stream, 'main');
        const delivered = runtime.steer(droid, 'late', 'late');
        await readText(stream, 'tail');
        assert.equal(await delivered, true);
        assert.equal(events.filter((event) => event.type === 'user').length, 1);
        assert.ok(
          events.some((event) => event.type === 'tool_result' && event.toolName === 'Task'),
        );
        await finish(stream);
        assert.equal(events.filter((event) => event.type === 'result').length, 1);
        assert.equal(events.at(-1)?.type, 'result');
        const result = events.at(-1);
        assert.ok(result?.type === 'result');
        assert.equal(result.result, 'tail');
        assert.equal(result.numTurns, 2);
        assert.equal(result.tokenUsage?.inputTokens, 20);
        assert.equal(result.tokenUsage?.outputTokens, 10);
        assert.equal(await runtime.steer(droid, 'after settlement', 'after settlement'), false);
      },
    );

    await t.test(
      'a steer shown before its loop starts keeps the turn open for its reply',
      async () => {
        const stream = start();
        await readText(stream, 'main');
        const delivered = runtime.steer(droid, 'idle-gap', 'idle-gap');
        await readText(stream, 'tail');
        assert.equal(await delivered, true);
        await finish(stream);
        assert.equal(events.at(-1)?.type, 'result');
      },
    );

    await t.test('RPC rejection cannot override confirmed delivery', async () => {
      const stream = start();
      await readText(stream, 'main');
      const delivered = runtime.steer(droid, 'delivered-rejected', 'delivered-rejected');
      await readText(stream, 'tail');
      assert.equal(await delivered, true);
      await finish(stream);
    });

    await t.test(
      'a steer Droid delivers while an interrupt is in flight stays delivered',
      async () => {
        const stream = start();
        await readText(stream, 'main');
        const pending = runtime.steer(droid, 'held-rpc', 'held-rpc');
        await readIdle(stream);
        let acknowledge = () => {};
        const acknowledgement = new Promise<void>((resolve) => {
          acknowledge = resolve;
        });
        const interrupt = t.mock.method(droid, 'interrupt', () => acknowledgement);
        const tail = (async () => {
          for await (const event of stream) events.push(event);
        })();
        try {
          const stopping = provider.interrupt();
          await droid.updateSettings({ modelId: 'deliver-held' });
          acknowledge();
          await stopping;
          assert.equal(await pending, true);
          await droid.updateSettings({ modelId: 'test-model' });
          await tail;
          assert.equal(events.at(-1)?.type, 'result');
          await droid.updateSettings({ modelId: 'release-rpc' });
        } finally {
          acknowledge();
          interrupt.mock.restore();
        }
      },
    );

    await t.test(
      'slash candidates use ordinary delivery; rejection, discard, Stop and close release waiters',
      async () => {
        for (const ending of ['reject', 'discard', 'stop', 'close'] as const) {
          const waiting = start();
          let first = await waiting.next();
          while (first.value?.type !== 'assistant_text_delta') {
            assert.equal(first.done, false);
            first = await waiting.next();
          }
          for (const text of ['  /command'])
            assert.equal(await runtime.steer(droid, text, text), false);
          const pending = runtime.steer(
            droid,
            ending === 'stop' || ending === 'close' ? 'held' : ending,
            ending,
          );
          if (ending === 'reject' || ending === 'discard') assert.equal(await pending, false);
          else {
            // The main idle arrives before this read. The tail has no more notices.
            await readIdle(waiting);
            const tail = waiting.next();
            if (ending === 'stop') await provider.interrupt();
            else await provider.close();
            assert.equal(await pending, false);
            assert.equal((await tail).value?.type, 'result');
          }
          for await (const event of waiting)
            assert.ok(
              event.type === 'tool_call_delta' ||
                event.type === 'token_usage_update' ||
                event.type === 'working_state_changed' ||
                event.type === 'result',
            );
        }
      },
    );
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
