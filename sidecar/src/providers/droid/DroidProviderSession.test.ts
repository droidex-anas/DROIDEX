import assert from 'node:assert/strict';
import test from 'node:test';
import {
  AutonomyLevel,
  DroidClient,
  DroidSession,
  InitializeSessionResultSchema,
  ReasoningEffort,
  ToolConfirmationOutcome,
  ToolConfirmationType,
  type DroidClientTransport,
  type RequestPermissionRequestParams,
} from '@factory/droid-sdk';

import { DroidRuntime, type FactorySession } from '../../DroidRuntime.js';
import { wrapDroidTransport } from '../../DroidTransport.js';
import type { NormalizedEvent } from '../../normalize.js';
import { successfulResultEvent } from '../../testing/fakeFactoryRuntime.js';
import { UsageLimitError } from '../usageLimit.js';
import { DroidProviderSession } from './DroidProviderSession.js';
import { droidInteractionHandlers } from './droidInteractions.js';

type RawListener = (note: Record<string, unknown>) => void;

// The Droid CLI as the session sees it: a turn's raw notifications reach the
// listeners before the stream yields, and every turn ends in a successful result.
function droidOn(modelId: string) {
  const listeners = new Set<RawListener>();
  const cli = {
    turn: (): unknown => undefined,
    onSettingsWrite: (settings: Parameters<FactorySession['updateSettings']>[0]): unknown =>
      void settings,
    onInterrupt: (): unknown => undefined,
    closed: false,
    notify(notification: Record<string, unknown>): void {
      for (const listener of listeners)
        listener({ method: 'droid.session_notification', params: { notification } });
    },
  };
  const droid = {
    sessionId: 'droid-1',
    initResult: { settings: { modelId, autonomyLevel: AutonomyLevel.Off } },
    onNotification(listener: RawListener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    async updateSettings(settings: Parameters<FactorySession['updateSettings']>[0]) {
      await cli.onSettingsWrite(settings);
      return {};
    },
    async interrupt() {
      await cli.onInterrupt();
    },
    async close() {
      cli.closed = true;
    },
    async *stream() {
      await cli.turn();
      yield successfulResultEvent('droid-1');
    },
  } as unknown as FactorySession;
  const runtime = {
    processIdOf: () => undefined,
    isProcessAlive: () => false,
    factoryApiKey: () => undefined,
    steer: () => Promise.resolve(false),
    streamTurn: (
      session: FactorySession,
      prompt: string,
      options: { includePartialMessages: true },
    ) => session.stream(prompt, options),
    observeNotification: () => undefined,
    interruptTurn: (session: FactorySession) => session.interrupt(),
    stopTurn: () => undefined,
  };
  return { cli, session: new DroidProviderSession('app-1', droid, runtime) };
}

const settingsUpdated = (modelId: string) => ({ type: 'settings_updated', settings: { modelId } });
const systemNotice = (text: string) => ({
  type: 'create_message',
  message: { role: 'system', visibility: 'user_only', content: [{ type: 'text', text }] },
});

async function turnEvents(turn: AsyncGenerator<NormalizedEvent>): Promise<NormalizedEvent[]> {
  const events: NormalizedEvent[] = [];
  for await (const event of turn) events.push(event);
  return events;
}

const switches = (events: NormalizedEvent[]) =>
  events.flatMap((event) => (event.harnessModelSwitch ? [event.harnessModelSwitch] : []));

test('Droid coalesces queued High into Off and waits for the native revocation before a turn', async () => {
  const { cli, session } = droidOn('model');
  const writes: unknown[] = [];
  let acceptMedium = () => {};
  let markStarted = () => {};
  const held = new Promise<void>((resolve) => {
    acceptMedium = resolve;
  });
  const started = new Promise<void>((resolve) => {
    markStarted = resolve;
  });
  let finishInterrupt = () => {};
  let markInterrupted = () => {};
  let interrupted = false;
  const interrupt = new Promise<void>((resolve) => {
    finishInterrupt = resolve;
  });
  const interruptStarted = new Promise<void>((resolve) => {
    markInterrupted = resolve;
  });
  cli.onInterrupt = () => {
    markInterrupted();
    return interrupt.then(() => {
      interrupted = true;
    });
  };
  cli.onSettingsWrite = async (settings) => {
    writes.push(settings.autonomyLevel);
    if (settings.autonomyLevel === AutonomyLevel.Medium) {
      markStarted();
      await held;
    } else assert.equal(interrupted, true, 'repair must wait for interruption');
  };
  const medium = session.setAutonomy('medium');
  await started;
  assert.equal(session.autonomy, 'off');
  const high = session.setAutonomy('high');
  const off = session.setAutonomy('off');
  let turns = 0;
  cli.turn = () => {
    assert.equal(writes.at(-1), AutonomyLevel.Off);
    turns += 1;
  };
  const turn = turnEvents(session.stream('go'));
  assert.equal(turns, 0);
  acceptMedium();
  await interruptStarted;
  assert.deepEqual(writes, [AutonomyLevel.Medium]);
  assert.equal(turns, 0);
  finishInterrupt();
  await Promise.all([medium, high, off, turn]);
  assert.deepEqual(writes, [AutonomyLevel.Medium, AutonomyLevel.Off]);
  assert.equal(session.autonomy, 'off');
  assert.equal(turns, 1);
  await session.close();
});

test('Droid disarms a refused escalation before the next ordinary prompt', async () => {
  const { cli, session } = droidOn('model');
  const writes: unknown[] = [];
  let refuse = true;
  cli.onSettingsWrite = (settings) => {
    writes.push(settings.autonomyLevel);
    if (refuse) throw new Error('escalation refused');
  };
  await assert.rejects(session.setAutonomy('high'), /escalation refused/);
  assert.equal(session.autonomy, 'off');
  refuse = false;
  let turns = 0;
  cli.turn = () => {
    turns += 1;
  };
  await turnEvents(session.stream('continue'));
  assert.equal(turns, 1);
  assert.deepEqual(writes, [AutonomyLevel.High, AutonomyLevel.High]);
  assert.equal(session.autonomy, 'off');
  await session.close();
});

test('Droid keeps refused Low to Off revocations for edit approval callbacks', async () => {
  const { cli, session } = droidOn('model');
  await session.setAutonomy('low');
  let asked = 0;
  const { permissionHandler } = droidInteractionHandlers(
    {
      id: 'app-1',
      get autonomy() {
        return session.autonomy;
      },
    },
    {
      requestApproval: async () => {
        asked += 1;
        return 'cancel';
      },
      requestQuestion: async () => ({ cancelled: true, answers: [] }),
      isActive: () => true,
      cancelPending: () => undefined,
    },
  );
  const edit: RequestPermissionRequestParams = {
    toolUses: [
      {
        toolUse: {
          type: 'tool_use',
          id: 'edit-1',
          name: 'Edit',
          input: { file_path: '/workspace/a' },
        },
        confirmationType: ToolConfirmationType.Edit,
        details: { type: ToolConfirmationType.Edit, filePath: '/workspace/a', fileName: 'a' },
      },
    ],
    options: [],
  };
  assert.equal(await permissionHandler(edit), ToolConfirmationOutcome.ProceedOnce);
  assert.equal(asked, 0);
  cli.onSettingsWrite = (settings) => {
    assert.equal(settings.autonomyLevel, AutonomyLevel.Off);
    throw new Error('revocation refused');
  };
  await assert.rejects(session.setAutonomy('off'), /revocation refused/);
  assert.equal(await permissionHandler(edit), ToolConfirmationOutcome.Cancel);
  assert.equal(asked, 1);
  assert.equal(session.autonomy, 'off');
  await session.close();
});

test('Droid closes the runtime if a failed downgrade cannot be interrupted or remains unapplied', async () => {
  for (const interruptFails of [true, false]) {
    const { cli, session } = droidOn('model');
    await session.setAutonomy('high');
    cli.onSettingsWrite = () => {
      throw new Error('revocation refused');
    };
    cli.onInterrupt = () => {
      if (interruptFails) throw new Error('interrupt refused');
    };
    await assert.rejects(session.setAutonomy('off'), /revocation refused/);
    assert.equal(cli.closed, true);
    assert.equal(session.isClosed, true);
    assert.equal(session.autonomy, 'off');
    await session.closed;
    let turns = 0;
    cli.turn = () => {
      turns += 1;
    };
    await assert.rejects(turnEvents(session.stream('blocked')), /closed/);
    assert.equal(turns, 0);
  }
});

test('Droid retires an obsolete successful escalation if interruption fails before repair', async () => {
  const { cli, session } = droidOn('model');
  let release = () => {};
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  let markStarted = () => {};
  const started = new Promise<void>((resolve) => {
    markStarted = resolve;
  });
  const writes: unknown[] = [];
  cli.onSettingsWrite = async (settings) => {
    writes.push(settings.autonomyLevel);
    markStarted();
    await held;
  };
  cli.onInterrupt = () => {
    throw new Error('interrupt refused');
  };
  const high = session.setAutonomy('high');
  const highFailure = assert.rejects(high, /closed/);
  await started;
  const off = session.setAutonomy('off');
  const offFailure = assert.rejects(off, /closed/);
  release();
  await Promise.all([highFailure, offFailure]);
  assert.equal(session.isClosed, true);
  assert.equal(session.autonomy, 'off');
  assert.deepEqual(writes, [AutonomyLevel.High]);
  await assert.rejects(turnEvents(session.stream('blocked')), /closed/);
});

test('a switch Droid makes on the usage limit is reported once, and never for our own write', async () => {
  const { cli, session } = droidOn('opus-5-5');
  cli.turn = () => {
    cli.notify(settingsUpdated('kimi-k2-7-core'));
    cli.notify(
      systemNotice(
        'Your standard model budget is exhausted. You have been switched to Kimi K2.7 Code (Droid Core) to continue this session as per your overage preference. To set your preferences, run the `/limits` slash command.',
      ),
    );
  };
  assert.deepEqual(switches(await turnEvents(session.stream('go on'))), [
    { from: 'opus-5-5', to: 'kimi-k2-7-core', cause: 'usage_limit' },
  ]);

  // A switch crossing DROIDEX's own write lands while the write is in flight,
  // ahead of the write's echo; the write decides the model.
  cli.onSettingsWrite = () => {
    cli.notify(settingsUpdated('glm-5-core'));
    cli.notify(settingsUpdated('sonnet-5'));
  };
  cli.turn = () => session.setModel({ modelId: 'sonnet-5' });
  assert.deepEqual(switches(await turnEvents(session.stream('and again'))), []);
});

test('a translated limit notice fails the turn with its detail and adds no row', async () => {
  const { cli, session } = droidOn('opus-5-5');
  cli.turn = () => {
    cli.notify(
      systemNotice(
        "Hai raggiunto il limite di utilizzo settimanale.\nQuesto viene ricontrollato a ogni messaggio, quindi se il tuo limite è stato aumentato o è stato reimpostato, invia un altro messaggio per continuare. Esegui `/limits` per vedere l'utilizzo.",
      ),
    );
  };
  const events: NormalizedEvent[] = [];
  await assert.rejects(
    async () => {
      for await (const event of session.stream('go on')) events.push(event);
    },
    (error) =>
      error instanceof UsageLimitError &&
      error.message === 'Hai raggiunto il limite di utilizzo settimanale.',
  );
  assert.deepEqual(
    events.filter((event) => event.transcript),
    [],
  );
});

// A session on the real SDK and runtime, over a transport the test speaks for
// Droid. Every request is answered at once, after the notices its hook sends.
async function droidOverMemory() {
  let receive: (message: Record<string, unknown>) => void = () => undefined;
  const hooks = new Map<unknown, (params: Record<string, unknown>) => void>();
  const init = InitializeSessionResultSchema.parse({
    sessionId: 'provider-session',
    session: {},
    settings: { modelId: 'test-model', reasoningEffort: ReasoningEffort.Medium },
  });
  const inner: DroidClientTransport = {
    isConnected: true,
    send(request) {
      const hook = hooks.get(request.method);
      hooks.delete(request.method);
      hook?.((request.params ?? {}) as Record<string, unknown>);
      receive({
        jsonrpc: '2.0',
        factoryApiVersion: '1.0.0',
        type: 'response',
        id: request.id,
        result: request.method === 'droid.initialize_session' ? init : {},
      });
    },
    onMessage(callback) {
      receive = callback;
    },
    onError() {},
    close: async () => undefined,
  };
  const transport = wrapDroidTransport(inner);
  const client = new DroidClient({ transport });
  await client.initializeSession({ machineId: 'test', cwd: '/tmp' });
  const droid = new DroidSession(client, init.sessionId, init);
  const runtime = new DroidRuntime();
  // Steering needs the client the runtime would have started the session on.
  Reflect.get(runtime, 'processes').set(droid, { pid: 1, transport, client });
  const notify = (notification: Record<string, unknown>) => {
    receive({
      jsonrpc: '2.0',
      factoryApiVersion: '1.0.0',
      type: 'notification',
      method: 'droid.session_notification',
      params: { notification },
    });
  };
  // Resolves once Droid receives the next request of this method, after hook.
  const nextRequest = (
    method: string,
    hook: (params: Record<string, unknown>) => void = () => {},
  ) =>
    new Promise<Record<string, unknown>>((resolve) => {
      hooks.set(method, (params) => {
        hook(params);
        resolve(params);
      });
    });
  return {
    session: new DroidProviderSession('app-session', droid, runtime),
    nextRequest,
    state: (newState: string) => {
      notify({ type: 'droid_working_state_changed', newState });
    },
    fail: (message = 'Model connection failed') => {
      notify({
        type: 'error',
        message,
        errorType: 'ConnectionError',
        timestamp: '2026-10-02T00:00:00Z',
      });
    },
    answer: (text: string) => {
      notify({ type: 'assistant_text_delta', messageId: text, blockIndex: 0, textDelta: text });
    },
    discardQueuedMessages: () => {
      notify({ type: 'queued_messages_discarded', text: '' });
    },
    showUserMessage: (id: unknown, text: string) => {
      notify({
        type: 'create_message',
        message: {
          id,
          role: 'user',
          createdAt: 0,
          updatedAt: 0,
          content: [{ type: 'text', text }],
        },
      });
    },
  };
}

// Lets the turn read every notice Droid has sent so far.
const turnCatchesUp = () => new Promise<void>((resolve) => setImmediate(resolve));

const texts = (events: NormalizedEvent[]) =>
  events.flatMap((event) => (event.transcript?.text ? [event.transcript.text] : []));

test('a delivered steer follows earlier output in both the main stream and the tail', async () => {
  for (const consumer of ['main', 'tail']) {
    const h = await droidOverMemory();
    try {
      const prompt = h.nextRequest('droid.add_user_message', () => {
        h.state('streaming_assistant_message');
      });
      const rows: string[] = [];
      const stream = (async () => {
        for await (const event of h.session.stream('hello'))
          if (event.transcript?.text) rows.push(event.transcript.text);
      })();
      await prompt;
      if (consumer === 'tail') h.state('idle');
      h.nextRequest('droid.add_user_message', ({ messageId }) => {
        h.state('streaming_assistant_message');
        h.answer('before1');
        h.answer('before2');
        h.showUserMessage(messageId, 'steer');
        h.answer('after');
        h.state('idle');
      });
      await h.session.steer('steer', undefined, 'steer').then((delivered) => {
        assert.equal(delivered, true);
        rows.push('steer');
      });
      await stream;
      assert.deepEqual(rows, ['before1', 'before2', 'steer', 'after'], consumer);
    } finally {
      await h.session.close();
    }
  }
});

// The SDK drops Droid's "thinking" state, so it never settles a loop that only
// thought; the runtime must end it.
test('a turn that thinks, fails and goes idle ends', { timeout: 2000 }, async () => {
  const h = await droidOverMemory();
  const prompt = h.nextRequest('droid.add_user_message', () => {
    h.state('thinking');
    h.fail();
    h.state('idle');
  });
  const events = turnEvents(h.session.stream('hello'));
  await prompt;
  assert.deepEqual(texts(await events), ['Model connection failed']);
  await h.session.close();
});

test(
  'a steer Droid shows before a failed thinking loop goes idle gets its reply',
  { timeout: 2000 },
  async () => {
    const h = await droidOverMemory();
    const prompt = h.nextRequest('droid.add_user_message', () => {
      h.state('thinking');
      h.fail();
    });
    const events = turnEvents(h.session.stream('hello'));
    await prompt;
    const steer = h.nextRequest('droid.add_user_message', ({ messageId }) => {
      h.showUserMessage(messageId, 'try again');
      h.state('idle');
    });
    const steered = h.session.steer('try again', undefined, 'try again');
    await steer;
    assert.equal(await steered, true);
    // The turn reads the idle before the reply loop starts.
    await turnCatchesUp();
    h.state('streaming_assistant_message');
    h.answer('Retried.');
    h.state('idle');
    assert.deepEqual(texts(await events), ['Model connection failed', 'Retried.']);
    await h.session.close();
  },
);

test(
  'a steer Droid shows after a failed thinking loop goes idle gets its reply',
  { timeout: 2000 },
  async () => {
    const h = await droidOverMemory();
    const prompt = h.nextRequest('droid.add_user_message', () => {
      h.state('thinking');
      h.fail();
    });
    const events = turnEvents(h.session.stream('hello'));
    await prompt;
    const steer = h.nextRequest('droid.add_user_message');
    const steered = h.session.steer('try again', undefined, 'try again');
    const { messageId } = await steer;
    h.state('idle');
    await turnCatchesUp();
    h.showUserMessage(messageId, 'try again');
    assert.equal(await steered, true);
    await turnCatchesUp();
    h.state('streaming_assistant_message');
    h.answer('Retried.');
    h.state('idle');
    assert.deepEqual(texts(await events), ['Model connection failed', 'Retried.']);
    await h.session.close();
  },
);

test(
  'a steer Droid shows before a thinking loop fails gets its reply loop, answer or refusal',
  { timeout: 2000 },
  async () => {
    const refusal = '429 Too Many Requests: Weekly Limit Exhausted';
    for (const reply of ['answer', 'refusal']) {
      const h = await droidOverMemory();
      const prompt = h.nextRequest('droid.add_user_message', () => {
        h.state('thinking');
      });
      const events = turnEvents(h.session.stream('hello'));
      await prompt;
      const steer = h.nextRequest('droid.add_user_message', ({ messageId }) => {
        h.showUserMessage(messageId, 'try again');
        h.fail();
        h.state('idle');
      });
      const steered = h.session.steer('try again', undefined, 'try again');
      await steer;
      assert.equal(await steered, true);
      await turnCatchesUp();
      h.state('streaming_assistant_message');
      if (reply === 'answer') h.answer('Retried.');
      else h.fail(refusal);
      h.state('idle');
      if (reply === 'answer')
        assert.deepEqual(texts(await events), ['Model connection failed', 'Retried.']);
      else
        await assert.rejects(
          events,
          (error) => error instanceof UsageLimitError && error.message === refusal,
        );
      await h.session.close();
    }
  },
);

test(
  'a steer Droid discards after a failed loop leaves it owed ends the turn',
  { timeout: 2000 },
  async () => {
    const h = await droidOverMemory();
    const prompt = h.nextRequest('droid.add_user_message', () => {
      h.state('streaming_assistant_message');
    });
    const events = turnEvents(h.session.stream('hello'));
    await prompt;
    const steer = h.nextRequest('droid.add_user_message', ({ messageId }) => {
      h.showUserMessage(messageId, 'try again');
      h.fail();
      h.state('idle');
    });
    const steered = h.session.steer('try again', undefined, 'try again');
    await steer;
    assert.equal(await steered, true);
    await turnCatchesUp();
    h.discardQueuedMessages();
    assert.deepEqual(texts(await events), ['Model connection failed']);
    await h.session.close();
  },
);

test(
  'a loop whose notices are all buffered before the stream reads them keeps its answer',
  { timeout: 2000 },
  async () => {
    const h = await droidOverMemory();
    const prompt = h.nextRequest('droid.add_user_message', () => {
      h.state('idle');
      h.state('streaming_assistant_message');
      h.answer('Answer.');
      h.state('idle');
    });
    const events = turnEvents(h.session.stream('hello'));
    await prompt;
    assert.deepEqual(texts(await events), ['Answer.']);
    await h.session.close();
  },
);

test(
  'a usage-limit refusal still fails the turn, whether or not the SDK saw the loop work',
  { timeout: 2000 },
  async () => {
    const refusal = '429 Too Many Requests: Weekly Limit Exhausted';
    for (const working of ['thinking', 'streaming_assistant_message']) {
      const h = await droidOverMemory();
      h.nextRequest('droid.add_user_message', () => {
        h.state('idle');
        h.state(working);
        h.fail(refusal);
        h.state('idle');
      });
      await assert.rejects(
        turnEvents(h.session.stream('hello')),
        (error) => error instanceof UsageLimitError && error.message === refusal,
      );
      await h.session.close();
    }
  },
);

test('an interrupt while Droid is thinking settles the turn', { timeout: 2000 }, async () => {
  const h = await droidOverMemory();
  const prompt = h.nextRequest('droid.add_user_message', () => {
    h.state('thinking');
  });
  const events = turnEvents(h.session.stream('hello'));
  await prompt;
  const interrupted = h.nextRequest('droid.interrupt_session', () => {
    h.state('idle');
  });
  await h.session.interrupt();
  await interrupted;
  assert.deepEqual(texts(await events), []);
  await h.session.close();
});
