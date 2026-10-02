import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';

import { DecompSessionType, InitializeSessionResultSchema } from '@factory/droid-sdk';

import { ChildSessions } from './ChildSessions.js';
import { MissionControlPolicy } from './MissionControlPolicy.js';
import type { ModelInfo, SessionSummary } from './protocol.js';
import { SessionLifecycle } from './SessionLifecycle.js';
import { SessionTimeline } from './SessionTimeline.js';
import { writeProviderConversation } from './testing/historyCharacterizationSupport.js';
import { assistantTextDelta, FakeFactorySession } from './testing/fakeFactoryRuntime.js';
import {
  createSessionManagerTestContext,
  type SessionManagerTestContext,
} from './testing/sessionManagerTestContext.js';

class DeferredDesignPolicySession extends FakeFactorySession {
  private rejectDesignPolicyUpdate?: (error: Error) => void;

  override updateSettings(
    settings: Parameters<FakeFactorySession['updateSettings']>[0],
  ): ReturnType<FakeFactorySession['updateSettings']> {
    if (!('disabledToolIds' in settings)) return super.updateSettings(settings);
    return new Promise((_, reject) => {
      this.rejectDesignPolicyUpdate = reject;
    });
  }

  rejectDesignPolicy(error: Error): void {
    assert.ok(this.rejectDesignPolicyUpdate);
    this.rejectDesignPolicyUpdate(error);
  }
}

type CreateCommand = Parameters<SessionManagerTestContext['create']>[0];

function chat(clientRef: string, patch: Partial<CreateCommand> = {}): CreateCommand {
  return {
    sessionPurpose: 'chat',
    clientRef,
    title: clientRef,
    goal: 'hello',
    interactionMode: 'auto',
    autonomy: 'low',
    ...patch,
  };
}

test('ordinary create initializes CLI and DROIDEX MCP servers without persisting them', async () => {
  const h = createSessionManagerTestContext();
  try {
    await h.create(chat('ordinary'));

    const options = h.runtime.createCalls[0];
    assert.ok(options);
    assert.equal(options.interactionMode, 'auto');
    assert.equal(options.autonomyLevel, 'low');
    assert.deepEqual(
      options.mcpServers?.map((server) => server.name),
      ['test-cli', 'test-browser', 'droidex-automations', 'droidex-sessions'],
      'the effective CLI MCP config and DROIDEX’s own tool servers must initialize together',
    );
    assert.equal(
      h.calls.some((call) => call.target === 'provider' && call.method === 'addMcpServer'),
      false,
      'DROIDEX-owned runtime servers must never be persisted into Droid user config',
    );
    assert.deepEqual(h.provider.session('provider-1').prompts, ['hello']);
  } finally {
    await h.dispose();
  }
});

test('create maps purpose and interaction mode independently onto provider options', async () => {
  const cases: {
    command: Partial<CreateCommand>;
    options: Record<string, unknown>;
    created: Partial<SessionSummary>;
  }[] = [
    {
      command: { interactionMode: 'spec', modelId: 'spec-model', reasoningEffort: 'high' },
      options: { interactionMode: 'spec', specModeModelId: 'spec-model', workerModelId: undefined },
      created: { sessionPurpose: 'chat', interactionMode: 'spec' },
    },
    {
      command: { sessionPurpose: 'design' },
      options: { decompSessionType: undefined },
      created: { sessionPurpose: 'design', interactionMode: 'auto', missionId: undefined },
    },
    {
      command: { interactionMode: 'agi' },
      options: { decompSessionType: undefined },
      created: { sessionPurpose: 'chat', interactionMode: 'agi', missionId: undefined },
    },
    {
      command: {
        sessionPurpose: 'mission-control',
        interactionMode: 'agi',
        workerModel: 'worker',
        validatorModel: 'validator',
      },
      options: {
        decompSessionType: DecompSessionType.Orchestrator,
        workerModelId: 'worker',
        validatorModelId: 'validator',
      },
      created: { sessionPurpose: 'mission-control' },
    },
  ];

  for (const { command, options, created } of cases) {
    const h = createSessionManagerTestContext();
    try {
      await h.create(chat('mapped', command));
      const createOptions = h.runtime.createCalls[0] as unknown as Record<string, unknown>;
      for (const [key, value] of Object.entries(options)) {
        assert.deepEqual(createOptions[key], value, `${JSON.stringify(command)}: ${key}`);
      }
      const session = h.events.find((event) => event.type === 'session.created')?.session;
      for (const [key, value] of Object.entries(created)) {
        assert.deepEqual(
          session?.[key as keyof SessionSummary],
          value,
          `${JSON.stringify(command)}: ${key}`,
        );
      }
    } finally {
      await h.dispose();
    }
  }
});

test("a session's live model catalog replaces the help-text catalog and is cached", async () => {
  const h = createSessionManagerTestContext();
  const session = new FakeFactorySession('live-catalog', {}, h.calls);
  session.initResult = InitializeSessionResultSchema.parse({
    ...session.initResult,
    availableModels: [
      {
        id: 'auto',
        displayName: 'Auto',
        shortDisplayName: 'Auto',
        modelProvider: 'factory',
        supportedReasoningEfforts: [],
        defaultReasoningEffort: 'medium',
      },
    ],
  });
  h.runtime.createQueue.push(session);

  try {
    await h.create(chat('live-catalog'));

    const catalog = h.events.findLast(
      (event) => event.type === 'catalog.updated' && event.catalog === 'models',
    );
    assert.ok(catalog?.type === 'catalog.updated');
    assert.deepEqual(
      (catalog.items as ModelInfo[]).map((model) => model.id),
      ['auto'],
    );
    const cached = JSON.parse(
      readFileSync(path.join(h.home, '.factory', 'droidex', 'model-catalog.json'), 'utf8'),
    ) as { source: string; models: { id: string }[] };
    assert.equal(cached.source, 'session');
    assert.deepEqual(
      cached.models.map((model) => model.id),
      ['auto'],
    );
  } finally {
    await h.dispose();
  }
});

test('App response formats enrich the provider prompt and unsupported ones never reach it', async () => {
  const h = createSessionManagerTestContext();

  try {
    await h.create(
      chat('app-format-create', {
        goal: '/visualize compare renderer timings',
        responseFormat: 'app-create',
      }),
    );

    const createPrompt = h.provider.session('provider-1').prompts[0];
    assert.match(createPrompt, /^DROIDEX App request:/);
    assert.match(createPrompt, /\/visualize compare renderer timings/);
    assert.match(createPrompt, /fenced `app` block/);

    await h.handle({
      type: 'session.send',
      appSessionId: 'provider-1',
      text: '/visualize turn this into a timeline',
      responseFormat: 'app-create',
    });
    await h.provider.waitForPrompts('provider-1', 2);
    const sendPrompt = h.provider.session('provider-1').prompts[1];
    assert.match(sendPrompt, /^DROIDEX App request:/);
    assert.match(sendPrompt, /\/visualize turn this into a timeline/);

    await assert.rejects(
      h.handle({
        type: 'session.send',
        appSessionId: 'provider-1',
        text: 'keep going',
        responseFormat: 'future-app-format',
      } as never),
      /Unsupported response format: future-app-format/,
    );
    assert.equal(h.provider.session('provider-1').prompts.length, 2);
  } finally {
    await h.dispose();
  }
});

test('resume preserves the app identity while loading the provider session', async () => {
  const h = createSessionManagerTestContext();

  try {
    h.fixture.seedHistorySummaries([summary('app-5', 'provider-5')]);
    writeProviderConversation(h.home, 'provider-5', 'Historical app-5');
    h.runtime.loadQueue.set('provider-5', [new FakeFactorySession('provider-5', {}, h.calls)]);
    await h.handle({ type: 'session.resume', appSessionId: 'app-5' });

    assert.equal(h.runtime.loadCalls.length, 1);
    assert.equal(h.runtime.loadCalls[0]?.sessionId, 'provider-5');
    assert.equal(
      h.events.find((event) => event.type === 'session.created')?.session.appSessionId,
      'app-5',
    );
    assert.ok(h.runtime.loadCalls[0]?.handlers.permissionHandler);
    assert.ok(h.runtime.loadCalls[0]?.handlers.askUserHandler);
  } finally {
    await h.dispose();
  }
});

test('resuming an AGI chat preserves its explicit non-Mission-Control purpose', async () => {
  const h = createSessionManagerTestContext();

  try {
    h.fixture.seedHistorySummaries([
      { ...summary('app-agi-chat', 'provider-agi-chat'), interactionMode: 'agi' },
    ]);
    writeProviderConversation(h.home, 'provider-agi-chat', 'AGI chat');
    h.runtime.loadQueue.set('provider-agi-chat', [
      new FakeFactorySession('provider-agi-chat', {}, h.calls, {
        settings: { interactionMode: 'agi' },
        mission: { state: 'running', features: [] },
      }),
    ]);

    await h.handle({ type: 'session.resume', appSessionId: 'app-agi-chat' });

    const resumed = h.events.find((event) => event.type === 'session.created')?.session;
    assert.equal(resumed?.sessionPurpose, 'chat');
    assert.equal(resumed?.interactionMode, 'agi');
    assert.equal(resumed?.missionId, undefined);
    assert.deepEqual(resumed?.features, []);
    assert.equal(resumed?.phase, 'paused');
    assert.equal(
      h.events.some((event) => event.type === 'mission.features'),
      false,
    );
  } finally {
    await h.dispose();
  }
});

test('mixed stable and provider identities preserve output across turns', async () => {
  const h = createSessionManagerTestContext();

  try {
    h.fixture.seedHistorySummaries([summary('app-alias', 'provider-alias')]);
    writeProviderConversation(h.home, 'provider-alias', 'Alias');
    const provider = new FakeFactorySession('provider-alias', {}, h.calls);
    provider.queueStreamEvents([assistantTextDelta('first answer', 'first-message')]);
    provider.queueStreamEvents([assistantTextDelta('second answer', 'second-message')]);
    h.runtime.loadQueue.set('provider-alias', [provider]);

    await h.handle({ type: 'session.send', appSessionId: 'app-alias', text: 'first' });
    await h.handle({ type: 'session.send', appSessionId: 'provider-alias', text: 'second' });

    const textEvents = h.events.flatMap((event) =>
      event.type === 'event.appended' && event.event.kind === 'text' ? [event.event] : [],
    );
    assert.deepEqual(provider.prompts, ['first', 'second']);
    assert.deepEqual(
      textEvents.map((event) => [event.text, event.appSessionId]),
      [
        ['first answer', 'app-alias'],
        ['second answer', 'app-alias'],
      ],
    );
  } finally {
    await h.dispose();
  }
});

test('provider aliases apply pending settings before the first send', async () => {
  const h = createSessionManagerTestContext();
  const providerSessionId = 'provider-pending-alias';

  try {
    h.fixture.seedHistorySummaries([
      { ...summary('app-pending-alias', providerSessionId), modelId: 'model-old' },
    ]);
    writeProviderConversation(h.home, providerSessionId, 'Pending alias');
    await h.handle({
      type: 'settings.agent.update',
      appSessionId: providerSessionId,
      agent: 'primary',
      modelId: 'model-default',
      reasoningEffort: 'high',
    });
    const stored = h.history.summaryPatchesAndHidden().patches.get('app-pending-alias');
    assert.equal(stored?.modelId, 'model-default', 'closed settings must be durable before send');
    assert.equal(stored?.reasoningEffort, 'high');
    const provider = new FakeFactorySession(providerSessionId, {}, h.calls, {
      settings: { modelId: 'model-old' },
    });
    h.runtime.loadQueue.set(providerSessionId, [provider]);

    await h.handle({
      type: 'session.send',
      appSessionId: providerSessionId,
      text: 'apply pending model',
    });

    const modelUpdateIndex = h.calls.findIndex((call) => {
      const settings = call.args[1];
      return (
        call.method === 'updateSettings' &&
        typeof settings === 'object' &&
        settings !== null &&
        'modelId' in settings &&
        settings.modelId === 'model-default'
      );
    });
    const streamIndex = h.calls.findIndex(
      (call) => call.method === 'stream' && call.args[1] === 'apply pending model',
    );
    assert.ok(modelUpdateIndex >= 0 && modelUpdateIndex < streamIndex);
    assert.deepEqual(provider.prompts, ['apply pending model']);
  } finally {
    await h.dispose();
  }
});

test('closing an active turn suppresses later provider errors and context refresh', async () => {
  const h = createSessionManagerTestContext();
  const gate = h.runtime.deferNextCreateStream('provider-close');

  try {
    await h.create(chat('close-active', { goal: 'wait' }));
    await h.provider.waitForPrompts('provider-close', 1);
    h.provider.session('provider-close').nextStreamError = new Error('transport closed');

    await h.handle({ type: 'session.close', appSessionId: 'provider-close' });
    const eventsAfterClose = h.events.length;
    gate.resolve();
    await h.waitForIdle();
    await h.waitForIdle();

    assert.deepEqual(h.events.slice(eventsAfterClose), []);
  } finally {
    await h.dispose();
  }
});

test('closing suppresses in-flight policy and context updates', async () => {
  const h = createSessionManagerTestContext();
  const provider = new DeferredDesignPolicySession('provider-late-effects', {}, h.calls);
  const streamGate = provider.deferNextStream();
  const contextGate = provider.deferNextContextStats();
  h.runtime.createQueue.push(provider);

  try {
    await h.create(chat('close-late-effects', { goal: 'wait' }));

    await h.handle({ type: 'session.close', appSessionId: 'provider-late-effects' });
    const eventsAfterClose = h.events.length;
    provider.rejectDesignPolicy(new Error('policy transport closed'));
    contextGate.resolve();
    streamGate.resolve();
    await h.waitForIdle();
    await h.waitForIdle();

    assert.deepEqual(h.events.slice(eventsAfterClose), []);
  } finally {
    await h.dispose();
  }
});

test('an interaction-mode change applies to the provider and reports a rejection', async () => {
  const h = createSessionManagerTestContext();

  try {
    await h.create(chat('mode', { goal: 'go' }));
    await h.handle({
      type: 'session.updateSettings',
      appSessionId: 'provider-1',
      interactionMode: 'spec',
    });
    assert.equal(
      h.calls.some((call) => call.method === 'enterSpecMode'),
      true,
    );
    const updated = h.events.filter((event) => event.type === 'session.updated').pop()?.session;
    assert.equal(updated?.interactionMode, 'spec');
    assert.equal(updated?.autonomy, 'low');

    const updatesBeforeFailure = h.events.filter(
      (event) => event.type === 'session.updated',
    ).length;
    h.provider.session('provider-1').nextEnterSpecModeError = new Error('mode rejected');
    await h.handle({
      type: 'session.updateSettings',
      appSessionId: 'provider-1',
      interactionMode: 'spec',
    });

    assert.equal(
      h.events.some(
        (event) =>
          event.type === 'error' &&
          event.message === 'Could not switch interaction mode: mode rejected',
      ),
      true,
    );
    assert.equal(
      h.events.filter((event) => event.type === 'session.updated').length,
      updatesBeforeFailure,
    );
  } finally {
    await h.dispose();
  }
});

test('summary patches preserve existing provider transcripts', async () => {
  const h = createSessionManagerTestContext();

  try {
    await h.create(chat('patch', { goal: 'go' }));
    const file = path.join(h.home, '.factory', 'sessions', 'provider-1.jsonl');
    const transcript =
      `${JSON.stringify({ type: 'session_start', sessionId: 'provider-1', sessionTitle: 'L11', cwd: '' })}\n` +
      `${JSON.stringify({
        type: 'message',
        message: { role: 'assistant', content: [{ type: 'text', text: 'preserve me' }] },
      })}\n`;
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, transcript);
    await h.waitForIdle();

    await h.handle({
      type: 'session.updateSettings',
      appSessionId: 'provider-1',
      autonomy: 'high',
    });

    assert.equal(
      h.events.filter((event) => event.type === 'session.updated').at(-1)?.session.autonomy,
      'high',
    );
    assert.equal(h.history.summaryPatchesAndHidden().patches.get('provider-1')?.autonomy, 'high');
    assert.equal(readFileSync(file, 'utf8'), transcript);
  } finally {
    await h.dispose();
  }
});

// Teardown: close and shutdown must leave nothing running behind them.

interface ObservedTimer {
  timer: ReturnType<typeof setTimeout>;
  clears: number;
}

function observeTimers() {
  type TimerCallback = (...args: unknown[]) => void;
  const originalSetInterval = globalThis.setInterval;
  const originalClearInterval = globalThis.clearInterval;
  const originalSetTimeout = globalThis.setTimeout;
  const originalClearTimeout = globalThis.clearTimeout;
  const intervals: ObservedTimer[] = [];
  const timeouts: ObservedTimer[] = [];

  Reflect.set(
    globalThis,
    'setInterval',
    (callback: TimerCallback, delay?: number, ...args: unknown[]) => {
      const timer = originalSetInterval(callback, delay, ...args);
      intervals.push({ timer, clears: 0 });
      return timer;
    },
  );
  Reflect.set(globalThis, 'clearInterval', (timer: ReturnType<typeof setInterval> | undefined) => {
    const observed = intervals.find((item) => item.timer === timer);
    if (observed) observed.clears += 1;
    originalClearInterval(timer);
  });
  Reflect.set(
    globalThis,
    'setTimeout',
    (callback: TimerCallback, delay?: number, ...args: unknown[]) => {
      const timer = originalSetTimeout(callback, delay, ...args);
      timeouts.push({ timer, clears: 0 });
      return timer;
    },
  );
  Reflect.set(globalThis, 'clearTimeout', (timer: ReturnType<typeof setTimeout> | undefined) => {
    const observed = timeouts.find((item) => item.timer === timer);
    if (observed) observed.clears += 1;
    originalClearTimeout(timer);
  });

  return {
    counts: () => [intervals.length, timeouts.length],
    restore: () => {
      Reflect.set(globalThis, 'setInterval', originalSetInterval);
      Reflect.set(globalThis, 'clearInterval', originalClearInterval);
      Reflect.set(globalThis, 'setTimeout', originalSetTimeout);
      Reflect.set(globalThis, 'clearTimeout', originalClearTimeout);
    },
  };
}

function notifyCompactionStarted(h: SessionManagerTestContext, providerSessionId: string): void {
  h.provider.emitNotification(providerSessionId, {
    jsonrpc: '2.0',
    method: 'droid.session_notification',
    params: {
      notification: {
        type: 'droid_working_state_changed',
        newState: 'compacting_conversation',
      },
    },
  });
}

function mission(clientRef: string): CreateCommand {
  return chat(clientRef, { sessionPurpose: 'mission-control', interactionMode: 'agi', goal: 'go' });
}

async function openPausedChild(
  h: SessionManagerTestContext,
  parentAppSessionId: string,
  childSessionId: string,
  providerSessionId: string,
): Promise<FakeFactorySession> {
  const child = new FakeFactorySession(providerSessionId, {}, h.calls);
  h.history.seedChildSessions([
    {
      parentAppSessionId,
      childSessionId,
      providerSessionId,
      role: 'worker',
      status: 'paused',
      modelId: 'model-default',
      transcriptAvailable: true,
      updatedAt: Date.now(),
    },
  ]);
  h.runtime.loadQueue.set(providerSessionId, [child]);
  await h.handle({
    type: 'child.open',
    parentAppSessionId,
    childSessionId,
    requestId: `open-${childSessionId}`,
  });
  return child;
}

const providerCloses = (h: SessionManagerTestContext, providerSessionId: string): number =>
  h.calls.filter(
    (call) =>
      call.target === 'cleanup' &&
      call.method === 'session.close' &&
      call.args[0] === providerSessionId,
  ).length;

for (const mode of ['close', 'shutdown'] as const) {
  test(`late active-child unwind cannot restart work after ${mode}`, async () => {
    const h = createSessionManagerTestContext();
    const timers = observeTimers();
    try {
      await h.create(mission('teardown'));
      await h.waitForIdle();
      const child = await openPausedChild(h, 'provider-1', 'child-logical', 'child-backend');
      const streamGate = child.deferNextStream();
      const contextGate = child.deferNextContextStats();
      const running = h.handle({
        type: 'child.send',
        parentAppSessionId: 'provider-1',
        childSessionId: 'child-logical',
        text: 'running',
      });
      await child.waitForPrompts(1);
      notifyCompactionStarted(h, 'child-backend');
      await h.handle({
        type: 'child.send',
        parentAppSessionId: 'provider-1',
        childSessionId: 'child-logical',
        text: 'must not drain',
      });

      if (mode === 'close') await h.handle({ type: 'session.close', appSessionId: 'provider-1' });
      else await h.shutdown();
      const timerCountsAfterTeardown = timers.counts();
      const eventCountAfterTeardown = h.events.length;
      assert.equal(providerCloses(h, 'child-backend'), 1);

      contextGate.resolve();
      streamGate.resolve();
      await running;
      await h.waitForIdle();

      assert.deepEqual(child.prompts, ['running']);
      assert.deepEqual(timers.counts(), timerCountsAfterTeardown);
      assert.equal(h.events.length, eventCountAfterTeardown);
      assert.equal(providerCloses(h, 'child-backend'), 1);
      if (mode === 'shutdown') {
        await assert.rejects(
          h.handle({ type: 'sessions.list' }),
          /Session manager is shutting down/,
        );
      }
    } finally {
      timers.restore();
      await h.dispose().catch(() => undefined);
    }
  });
}

test('shutdown marks later parents before blocked earlier cleanup', async () => {
  const h = createSessionManagerTestContext();
  const timers = observeTimers();
  try {
    const first = new FakeFactorySession('parent-a', {}, h.calls);
    const second = new FakeFactorySession('parent-b', {}, h.calls);
    h.runtime.createQueue.push(first, second);
    await h.create(mission('parent-a'));
    await first.waitForPrompts(1);
    await h.create(mission('parent-b'));
    await second.waitForPrompts(1);
    await h.waitForIdle();

    const child = await openPausedChild(h, 'parent-b', 'child-b-logical', 'child-b-backend');
    const streamGate = child.deferNextStream();
    const contextGate = child.deferNextContextStats();
    const running = h.handle({
      type: 'child.send',
      parentAppSessionId: 'parent-b',
      childSessionId: 'child-b-logical',
      text: 'running on B',
    });
    await child.waitForPrompts(1);
    notifyCompactionStarted(h, 'child-b-backend');

    const firstCloseGate = first.deferNextClose();
    const shutdown = h.shutdown();
    await h.waitForIdle();
    const timersWhileFirstBlocked = timers.counts();
    const eventsWhileFirstBlocked = h.events.length;

    contextGate.resolve();
    streamGate.resolve();
    await running;
    await h.waitForIdle();
    assert.deepEqual(child.prompts, ['running on B']);
    assert.deepEqual(timers.counts(), timersWhileFirstBlocked);
    assert.equal(h.events.length, eventsWhileFirstBlocked);
    assert.equal(providerCloses(h, 'parent-b'), 0);

    firstCloseGate.resolve();
    await shutdown;
  } finally {
    timers.restore();
    await h.dispose().catch(() => undefined);
  }
});

test('shutdown is single-flight and finalizers continue after failure', async () => {
  const h = createSessionManagerTestContext();
  h.browsers.nextCloseAllError = new Error('browser closeAll failed');
  h.history.nextCloseError = new Error('history close failed');

  const results = await Promise.allSettled([h.shutdown(), h.shutdown()]);
  assert.deepEqual(
    results.map((result) => result.status),
    ['rejected', 'rejected'],
  );
  assert.equal(
    h.calls.filter((call) => call.target === 'cleanup' && call.method === 'browser.closeAll')
      .length,
    1,
  );
  assert.equal(
    h.calls.filter((call) => call.target === 'cleanup' && call.method === 'history.close').length,
    1,
  );
  assert.match(
    results[0]?.status === 'rejected' ? String(results[0].reason) : '',
    /browser closeAll failed/,
  );

  await h.dispose().catch(() => undefined);
});

test('shutdown sweeps children before clearing Mission policy and drains timelines before history closes', async () => {
  const order: string[] = [];
  const closeAll = SessionLifecycle.prototype.closeAll;
  const shutdownChildren = ChildSessions.prototype.shutdown;
  const clearMission = MissionControlPolicy.prototype.clear;
  const flushStreaming = SessionTimeline.prototype.flushStreaming;
  SessionLifecycle.prototype.closeAll = async function () {
    await closeAll.call(this);
    order.push('lifecycle.closeAll');
  };
  ChildSessions.prototype.shutdown = async function () {
    order.push('children.shutdown');
    await shutdownChildren.call(this);
  };
  MissionControlPolicy.prototype.clear = function () {
    order.push('mission.clear');
    clearMission.call(this);
  };
  SessionTimeline.prototype.flushStreaming = function () {
    order.push('timeline.flushStreaming');
    flushStreaming.call(this);
  };

  const h = createSessionManagerTestContext();
  const historyClose = h.history.close.bind(h.history);
  h.history.close = () => {
    order.push('history.close');
    historyClose();
  };
  try {
    await h.shutdown();
    assert.deepEqual(
      order.filter((step) => step !== 'timeline.flushStreaming' && step !== 'history.close'),
      ['lifecycle.closeAll', 'children.shutdown', 'mission.clear'],
    );
    assert.ok(order.lastIndexOf('timeline.flushStreaming') < order.indexOf('history.close'));
  } finally {
    SessionLifecycle.prototype.closeAll = closeAll;
    ChildSessions.prototype.shutdown = shutdownChildren;
    MissionControlPolicy.prototype.clear = clearMission;
    SessionTimeline.prototype.flushStreaming = flushStreaming;
    await h.dispose();
  }
});

function summary(appSessionId: string, providerSessionId: string): SessionSummary {
  const now = Date.now();
  return {
    appSessionId,
    providerSessionId,
    provider: 'droid',
    sessionPurpose: 'chat',
    interactionMode: 'auto',
    role: 'primary',
    title: `Historical ${appSessionId}`,
    goal: '',
    cwd: '',
    workspaceKind: 'none',
    autonomy: 'low',
    phase: 'paused',
    streaming: false,
    queuedSends: 0,
    features: [],
    tokensIn: 0,
    tokensOut: 0,
    contextTokens: 0,
    createdAt: now,
    updatedAt: now,
  };
}
