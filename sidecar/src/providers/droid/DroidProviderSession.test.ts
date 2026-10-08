import assert from 'node:assert/strict';
import test from 'node:test';
import {
  AutonomyLevel,
  DroidClient,
  DroidSession,
  InitializeSessionResultSchema,
  ReasoningEffort,
  type DroidClientTransport,
} from '@factory/droid-sdk';

import { DroidRuntime, type FactorySession } from '../../DroidRuntime.js';
import { wrapDroidTransport } from '../../DroidTransport.js';
import type { NormalizedEvent } from '../../normalize.js';
import { successfulResultEvent } from '../../testing/fakeFactoryRuntime.js';
import { UsageLimitError } from '../usageLimit.js';
import { DroidProviderSession } from './DroidProviderSession.js';

type RawListener = (note: Record<string, unknown>) => void;

// The Droid CLI as the session sees it: a turn's raw notifications reach the
// listeners before the stream yields, and every turn ends in a successful result.
function droidOn(modelId: string) {
  const listeners = new Set<RawListener>();
  const cli = {
    turn: (): unknown => undefined,
    onSettingsWrite: (settings: Parameters<FactorySession['updateSettings']>[0]): unknown =>
      void settings,
    onInterrupt: (): void => undefined,
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
      cli.onInterrupt();
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

test('Droid interrupts a failed native revocation and retries before starting any new turn', async () => {
  const { cli, session } = droidOn('model');
  let nativeLevel = AutonomyLevel.Off;
  let refuseRevocation = false;
  let interrupts = 0;
  let turns = 0;
  cli.onSettingsWrite = async (settings) => {
    if (settings.autonomyLevel === AutonomyLevel.Off && refuseRevocation)
      throw new Error('refused');
    nativeLevel = settings.autonomyLevel ?? nativeLevel;
  };
  let releaseTurn = () => {};
  const running = new Promise<void>((resolve) => {
    releaseTurn = resolve;
  });
  let markStarted = () => {};
  const started = new Promise<void>((resolve) => {
    markStarted = resolve;
  });
  cli.turn = () => {
    turns += 1;
    markStarted();
    return running;
  };
  cli.onInterrupt = () => {
    interrupts += 1;
    releaseTurn();
  };
  await session.setAutonomy('high');
  const turn = turnEvents(session.stream('go'));
  await started;
  refuseRevocation = true;
  await assert.rejects(session.setAutonomy('off'), /refused/);
  await turn;
  assert.equal(interrupts, 1);
  assert.equal(nativeLevel, AutonomyLevel.High);
  assert.equal(session.autonomy, 'off');
  await assert.rejects(turnEvents(session.stream('blocked')), /refused/);
  assert.equal(turns, 1);
  refuseRevocation = false;
  cli.turn = () => {
    turns += 1;
    assert.equal(nativeLevel, AutonomyLevel.Off);
  };
  await turnEvents(session.stream('recovered'));
  assert.equal(turns, 2);

  let acceptGrant = () => {};
  const grant = new Promise<void>((resolve) => {
    acceptGrant = resolve;
  });
  const grantStarted = new Promise<void>((resolve) => {
    cli.onSettingsWrite = async (settings) => {
      if (settings.autonomyLevel === AutonomyLevel.High) {
        resolve();
        await grant;
      }
      nativeLevel = settings.autonomyLevel ?? nativeLevel;
    };
  });
  const raised = session.setAutonomy('high');
  await grantStarted;
  const revoked = session.setAutonomy('off');
  acceptGrant();
  await raised;
  assert.equal(nativeLevel, AutonomyLevel.Off);
  await revoked;
  assert.equal(session.autonomy, 'off');
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
    const steered = h.session.steer('try again');
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
    const steered = h.session.steer('try again');
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
      const steered = h.session.steer('try again');
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
    const steered = h.session.steer('try again');
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
