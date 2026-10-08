import assert from 'node:assert/strict';
import test from 'node:test';

import type { DroidStreamEvent } from '@factory/droid-sdk';

import type * as Protocol from './protocol.js';
import type { SessionFileWatcherOptions } from './sessionFileWatcher.js';
import { CanvasScopes } from './canvas/canvasScopes.js';
import { CanvasTurns } from './canvas/canvasTurnContext.js';
import { deferred } from './testing/canvasStorageSupport.js';
import {
  nativeSnapshot,
  nativeSuccess,
  observeNativeBrowserTimeouts,
} from './testing/browserCharacterizationSupport.js';
import { assistantTextDelta, FakeFactorySession } from './testing/fakeFactoryRuntime.js';
import {
  chatCommand,
  createNativeBrowserTestContext,
  createSessionManagerTestContext,
  notifyDaemonCompaction,
  providerCloses,
  sessionUpdates,
  type SessionCreateInput,
  type SessionManagerTestContext,
} from './testing/sessionManagerTestContext.js';

// Turns across the facade: how a failed turn settles, what a close or shutdown
// leaves running, and which session a browser stays bound to.

async function createSession(h: SessionManagerTestContext): Promise<FakeFactorySession> {
  await h.create(chatCommand('event-flow', { goal: 'initial' }));
  await h.provider.waitForPrompts('provider-1', 1);
  await h.waitForIdle();
  return h.provider.session('provider-1');
}

const send = (h: SessionManagerTestContext, text: string): Promise<void> =>
  h.handle({ type: 'session.send', appSessionId: 'provider-1', text });

const latestSummary = (h: SessionManagerTestContext) => sessionUpdates(h.events).at(-1);

test('a fresh chat can read Canvas through its configured endpoint while its turn runs', async () => {
  const h = createSessionManagerTestContext();
  let gate;
  try {
    await h.create(chatCommand('canvas-admission', { goal: '' }));
    const created = h.events.find((event) => event.type === 'session.created');
    assert.ok(created);
    const id = created.session.appSessionId;
    gate = h.provider.deferNextStream(id);
    const sending = h.handle({ type: 'session.send', appSessionId: id, text: 'Explore Canvas' });
    await h.provider.waitForPrompts(id, 1);
    const config = h.runtime.createCalls[0].mcpServers?.find(
      (entry) => entry.name === 'droidex-canvas',
    );
    assert.ok(config && 'url' in config);
    const response = await fetch(config.url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: { name: 'canvas_read', arguments: {} },
      }),
    });
    const text = await response.text();
    const data =
      text
        .split('\n')
        .find((line) => line.startsWith('data: '))
        ?.slice(6) ?? text;
    const reply = JSON.parse(JSON.parse(data).result.content[0].text);
    assert.equal(reply.ok, true);
    assert.equal(reply.attached, false);
    assert.ok(reply.scopeId);
    gate.resolve();
    await sending;
  } finally {
    gate?.resolve();
    await h.dispose();
  }
});

function taskRun(toolUseId: string, subagentType: string, result: string): DroidStreamEvent[] {
  return [
    {
      type: 'tool_call',
      toolUse: {
        type: 'tool_use',
        id: toolUseId,
        name: 'Task',
        input: { subagent_type: subagentType, description: `${subagentType} work` },
      },
    },
    { type: 'tool_result', toolName: 'Task', toolUseId, content: result, isError: false },
  ];
}

// An idle parent is woken once its background agent finishes; the wake waits for
// either kind of compaction to complete first.
for (const compaction of ['manual', 'automatic'] as const)
  test(`background Task completion wakes once after ${compaction} compaction`, async () => {
    const h = createSessionManagerTestContext();
    try {
      const provider = await createSession(h);
      h.events.length = 0;
      h.history.seedSessionLaunchSettings('provider-child-background', {
        modelId: 'custom:glm-5.2',
        reasoningEffort: 'max',
      });

      provider.queueStreamEvents(
        taskRun(
          'task-background',
          'worker-2',
          'Task launched in background.\ntask_id: provider-child-background\nsession_id: provider-child-background',
        ),
      );
      await send(h, 'launch background worker');

      const launched = h.history.childSessions('provider-1')[0];
      assert.equal(launched?.status, 'running');
      assert.equal(launched?.label, 'worker-2');
      assert.equal(launched?.modelId, 'custom:glm-5.2');
      assert.equal(launched?.reasoningEffort, 'max');

      const compactGate =
        compaction === 'manual' ? h.provider.deferNextCompaction('provider-1') : undefined;
      const compacting =
        compaction === 'manual'
          ? h.handle({ type: 'session.compact', appSessionId: 'provider-1' })
          : undefined;
      if (compaction === 'automatic') notifyDaemonCompaction(h, 'provider-1', 'started');
      await h.waitForIdle();
      h.provider.emitNotification('provider-1', {
        jsonrpc: '2.0',
        method: 'droid.session_notification',
        params: {
          notification: {
            type: 'create_message',
            message: {
              id: 'background-completion-message',
              role: 'user',
              content: [
                {
                  type: 'text',
                  text: 'Background task completed.\ntask_id: provider-child-background\noutput: done',
                },
              ],
              createdAt: Date.now(),
              updatedAt: Date.now(),
            },
          },
        },
      });

      assert.equal(h.history.childSessions('provider-1')[0]?.status, 'completed');
      assert.equal(
        h.events.some(
          (event) =>
            event.type === 'session.child' &&
            event.child.childSessionId === 'child-1' &&
            event.child.status === 'completed',
        ),
        true,
      );

      assert.equal(provider.prompts.length, 2);
      compactGate?.resolve();
      await compacting;
      if (compaction === 'automatic') notifyDaemonCompaction(h, 'provider-1', 'completed');
      await provider.waitForPrompts(3);
      await h.waitForIdle();
      assert.deepEqual(provider.prompts.slice(2), [
        [
          'The agents you started have finished while this chat was idle.',
          '- worker-2: completed',
          'Continue from these results.',
        ].join('\n'),
      ]);
      const appended = h.events.filter((event) => event.type === 'event.appended');
      assert.equal(
        appended.filter(
          (event) =>
            event.event.kind === 'status' && event.event.text === 'Agents finished; continuing',
        ).length,
        1,
      );
      assert.equal(
        appended.some((event) => event.event.role === 'primary' && event.event.author === 'user'),
        false,
      );
    } finally {
      await h.dispose();
    }
  });

test('an agent that settles inside the parent turn does not wake it a second time', async () => {
  const h = createSessionManagerTestContext();
  try {
    const provider = await createSession(h);
    h.history.seedSessionLaunchSettings('provider-child-foreground', { modelId: 'custom:glm-5.2' });

    provider.queueStreamEvents(
      taskRun('task-foreground', 'worker-2', 'session_id: provider-child-foreground\n\ndone'),
    );
    await send(h, 'run worker in this turn');
    await h.waitForIdle();

    // The agent ran and finished inside the parent's own turn, which read its
    // result: a wake would only repeat what the parent already has.
    assert.equal(h.history.childSessions('provider-1')[0]?.status, 'completed');
    assert.deepEqual(provider.prompts, ['initial', 'run worker in this turn']);
  } finally {
    await h.dispose();
  }
});

test('design turns synchronize TodoWrite and unexpected AbortErrors fail the turn', async () => {
  const h = createSessionManagerTestContext();
  try {
    const provider = await createSession(h);

    await send(
      h,
      'Design Mode reference pack:\n- URL: about:blank\n\nUser instruction:\nMake the hero cleaner',
    );
    await send(h, 'restore normal tools');
    await send(h, 'normal tools stay restored');

    assert.deepEqual(
      provider.settings.flatMap((settings) =>
        settings['disabledToolIds'] === undefined ? [] : [settings['disabledToolIds']],
      ),
      [[], ['TodoWrite'], []],
    );

    const abort = new Error('The operation was aborted');
    abort.name = 'AbortError';
    provider.nextStreamError = abort;
    await send(h, 'unexpected abort');

    assert.equal(
      h.events.some(
        (event) =>
          event.type === 'error' &&
          event.appSessionId === 'provider-1' &&
          event.message === abort.message,
      ),
      true,
    );
    assert.equal(latestSummary(h)?.phase, 'failed');
  } finally {
    await h.dispose();
  }
});

test('a buffered streaming tail is emitted before failed turn settlement', async () => {
  const h = createSessionManagerTestContext({ streamingCoalesceMs: 1_000 });
  try {
    const provider = await createSession(h);
    h.events.length = 0;

    provider.queueStreamEvents([assistantTextDelta('buffered before failure')]);
    provider.nextStreamError = new Error('provider failed');
    await send(h, 'fail after a partial response');
    await h.waitForIdle();

    const appendedIndex = h.events.findIndex(
      (event) => event.type === 'event.appended' && event.event.text === 'buffered before failure',
    );
    const errorIndex = h.events.findIndex(
      (event) => event.type === 'error' && event.message === 'provider failed',
    );
    const failedIndex = h.events.findIndex(
      (event) => event.type === 'session.updated' && event.session.phase === 'failed',
    );
    const errorRows = h.events.flatMap((event) =>
      event.type === 'event.appended' && event.event.kind === 'error' ? [event.event] : [],
    );
    assert.equal(errorRows.length, 1);
    assert.equal(errorRows[0]?.text, 'provider failed');
    assert.ok(appendedIndex >= 0);
    assert.ok(errorIndex > appendedIndex);
    assert.ok(failedIndex > errorIndex);
  } finally {
    await h.dispose();
  }
});

test('primary streaming persistence failures still settle and refresh context', async () => {
  const h = createSessionManagerTestContext({ streamingCoalesceMs: 1_000 });
  try {
    const provider = await createSession(h);
    const contextStatsCallsBeforeTurn = provider.contextStatsCalls;
    h.events.length = 0;

    provider.queueStreamEvents([assistantTextDelta('cannot persist this tail')]);
    h.history.recordEventErrorForText = {
      text: 'cannot persist this tail',
      error: new Error('history write failed'),
    };
    await send(h, 'trigger a streaming persistence failure');
    await h.waitForIdle();

    assert.equal(
      h.events.filter(
        (event) =>
          event.type === 'error' &&
          event.message === 'Could not persist streaming transcript: history write failed',
      ).length,
      1,
    );
    assert.equal(latestSummary(h)?.phase, 'failed');
    assert.ok(provider.contextStatsCalls >= contextStatsCallsBeforeTurn + 2);
    assert.equal(
      h.events.some(
        (event) =>
          event.type === 'event.appended' && event.event.text === 'cannot persist this tail',
      ),
      false,
    );
  } finally {
    await h.dispose();
  }
});

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

test('a close suppresses late stream errors, policy rejections, and context refreshes', async () => {
  const h = createSessionManagerTestContext();
  const streamGate = h.runtime.deferNextCreateStream('provider-close');
  const policy = new DeferredDesignPolicySession('provider-late-effects', {}, h.calls);
  const policyStreamGate = policy.deferNextStream();
  const contextGate = policy.deferNextContextStats();
  h.runtime.createQueue.push(policy);

  try {
    await h.create(chatCommand('close-active', { goal: 'wait' }));
    await h.provider.waitForPrompts('provider-close', 1);
    h.provider.session('provider-close').nextStreamError = new Error('transport closed');
    await h.create(chatCommand('close-late-effects', { goal: 'wait' }));

    await h.handle({ type: 'session.close', appSessionId: 'provider-close' });
    await h.handle({ type: 'session.close', appSessionId: 'provider-late-effects' });
    const eventsAfterClose = h.events.length;
    streamGate.resolve();
    policy.rejectDesignPolicy(new Error('policy transport closed'));
    contextGate.resolve();
    policyStreamGate.resolve();
    await h.waitForIdle();
    await h.waitForIdle();

    assert.deepEqual(h.events.slice(eventsAfterClose), []);
  } finally {
    await h.dispose();
  }
});

// Teardown: close and shutdown must leave nothing running behind them.

function observeTimers() {
  type TimerCallback = (...args: unknown[]) => void;
  const originalSetInterval = globalThis.setInterval;
  const originalSetTimeout = globalThis.setTimeout;
  let created = 0;
  Reflect.set(
    globalThis,
    'setInterval',
    (callback: TimerCallback, delay?: number, ...args: unknown[]) => {
      created += 1;
      return originalSetInterval(callback, delay, ...args);
    },
  );
  Reflect.set(
    globalThis,
    'setTimeout',
    (callback: TimerCallback, delay?: number, ...args: unknown[]) => {
      created += 1;
      return originalSetTimeout(callback, delay, ...args);
    },
  );
  return {
    created: () => created,
    restore: () => {
      Reflect.set(globalThis, 'setInterval', originalSetInterval);
      Reflect.set(globalThis, 'setTimeout', originalSetTimeout);
    },
  };
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

const mission = (clientRef: string): SessionCreateInput =>
  chatCommand(clientRef, { sessionPurpose: 'mission-control', interactionMode: 'agi', goal: 'go' });

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
      notifyDaemonCompaction(h, 'child-backend', 'started');
      await h.handle({
        type: 'child.send',
        parentAppSessionId: 'provider-1',
        childSessionId: 'child-logical',
        text: 'must not drain',
      });

      if (mode === 'close') await h.handle({ type: 'session.close', appSessionId: 'provider-1' });
      else await h.shutdown();
      const timersAfterTeardown = timers.created();
      const eventCountAfterTeardown = h.events.length;
      assert.equal(providerCloses(h, 'child-backend').length, 1);

      contextGate.resolve();
      streamGate.resolve();
      await running;
      await h.waitForIdle();

      assert.deepEqual(child.prompts, ['running']);
      assert.equal(timers.created(), timersAfterTeardown);
      assert.equal(h.events.length, eventCountAfterTeardown);
      assert.equal(providerCloses(h, 'child-backend').length, 1);
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
    notifyDaemonCompaction(h, 'child-b-backend', 'started');

    const firstCloseGate = first.deferNextClose();
    const shutdown = h.shutdown();
    await h.waitForIdle();
    const timersWhileFirstBlocked = timers.created();
    const eventsWhileFirstBlocked = h.events.length;

    contextGate.resolve();
    streamGate.resolve();
    await running;
    await h.waitForIdle();
    assert.deepEqual(child.prompts, ['running on B']);
    assert.equal(timers.created(), timersWhileFirstBlocked);
    assert.equal(h.events.length, eventsWhileFirstBlocked);
    assert.deepEqual(providerCloses(h, 'parent-b'), []);

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
  const cleanups = (method: string) =>
    h.calls.filter((call) => call.target === 'cleanup' && call.method === method).length;

  const results = await Promise.allSettled([h.shutdown(), h.shutdown()]);
  assert.deepEqual(
    results.map((result) => result.status),
    ['rejected', 'rejected'],
  );
  assert.equal(cleanups('browser.closeAll'), 1);
  assert.equal(cleanups('history.close'), 1);
  assert.match(
    results[0]?.status === 'rejected' ? String(results[0].reason) : '',
    /browser closeAll failed/,
  );

  await h.dispose().catch(() => undefined);
});

test('shutdown revokes turn scopes before held session-file reconciliation settles', async (t) => {
  const turns = new CanvasTurns(new CanvasScopes(), () => null);
  const watchers: SessionFileWatcherOptions[] = [];
  const h = createSessionManagerTestContext({
    canvasTurns: turns,
    startSessionFileWatcher: (options) => {
      watchers.push(options);
      return {
        liveSessionFile: () => undefined,
        consumeLiveSessionFile: () => undefined,
        close: () => undefined,
      };
    },
  });
  const reconcile = deferred();
  const reached = deferred();
  const stream = h.runtime.deferNextCreateStream('provider-1');
  try {
    await h.create(chatCommand('canvas-shutdown', { goal: 'keep the turn open' }));
    await h.provider.waitForPrompts('provider-1', 1);
    const scope = turns.activeScope('provider-1');
    assert.ok(scope);
    await h.handle({ type: 'sessions.list' });
    t.mock.method(h.history, 'reconcileSessionFiles', async () => {
      reached.resolve();
      await reconcile.promise;
      return 0;
    });
    assert.ok(watchers[0]);
    watchers[0].onExternalChange(null);
    await reached.promise;
    const closing = h.shutdown();
    try {
      assert.throws(() => turns.requireScope(scope.scopeId), { code: 'invalid_input' });
    } finally {
      reconcile.resolve();
      stream.resolve();
      await closing;
    }
  } finally {
    reconcile.resolve();
    stream.resolve();
    await h.dispose();
  }
});

test('the browser stays bound to the stable session across a provider swap', async () => {
  const h = createSessionManagerTestContext();
  const appSessionId = 'provider-1';

  try {
    await h.create(chatCommand('b3', { goal: 'go' }));
    await h.waitForIdle();
    h.provider.session(appSessionId).nextCompactResult = {
      newSessionId: 'provider-2',
      removedCount: 1,
    };
    h.runtime.loadQueue.set('provider-2', [new FakeFactorySession('provider-2', {}, h.calls)]);

    await h.handle({ type: 'browser.open', appSessionId, url: 'https://example.test' });
    assert.equal(h.events.at(-1)?.type, 'browser.updated');
    await h.handle({ type: 'session.compact', appSessionId });
    const browserUpdatesBeforeReload = h.events.filter((event) => event.type === 'browser.updated');
    await h.handle({ type: 'browser.reload', appSessionId });
    await h.handle({ type: 'browser.reload', appSessionId: 'missing' });

    assert.deepEqual(
      h.browsers.calls
        .filter((call) => call.target === 'browser')
        .map((call) => [call.method, call.args[0]]),
      [
        ['open', { type: 'browser.open', appSessionId, url: 'https://example.test' }],
        ['reload', appSessionId],
      ],
    );
    assert.equal(sessionUpdates(h.events, appSessionId).at(-1)?.providerSessionId, 'provider-2');
    const browserUpdates = h.events.filter(
      (event): event is Extract<Protocol.ServerEvent, { type: 'browser.updated' }> =>
        event.type === 'browser.updated',
    );
    assert.equal(browserUpdates.length > browserUpdatesBeforeReload.length, true);
    assert.equal(browserUpdates.at(-1)?.state.appSessionId, appSessionId);
    assert.equal(
      h.events.some(
        (event) =>
          event.type === 'browser.error' &&
          event.appSessionId === 'missing' &&
          event.message === 'Browser session is not open yet.',
      ),
      true,
    );
  } finally {
    await h.dispose();
  }
});

test('native browser results settle only the request they answer, and late results are ignored', async () => {
  const timeouts = observeNativeBrowserTimeouts();
  const h = createNativeBrowserTestContext();
  const nativeRequest = () =>
    h.events.filter((event) => event.type === 'browser.native.request').at(-1)?.request;
  const browserError = (message: RegExp) =>
    h.events.some(
      (event) =>
        event.type === 'browser.error' &&
        event.appSessionId === 'app-b2' &&
        message.test(event.message),
    );

  try {
    let opened = false;
    const open = h.handle({
      type: 'browser.open',
      appSessionId: 'app-b2',
      url: 'https://example.test',
    });
    void open.then(() => {
      opened = true;
    });
    const request = nativeRequest();
    assert.ok(request);

    await h.handle({
      type: 'browser.native.result',
      result: {
        requestId: 'unknown',
        appSessionId: 'app-b2',
        browserSessionId: 'browser-b2',
        ok: true,
      },
    });
    assert.equal(opened, false);

    await h.handle({
      type: 'browser.native.result',
      result: nativeSuccess(request, nativeSnapshot('https://example.test')),
    });
    await open;
    assert.equal(opened, true);
    assert.equal(
      h.events.some(
        (event) =>
          event.type === 'browser.updated' &&
          event.state.appSessionId === 'app-b2' &&
          event.state.url === 'https://example.test',
      ),
      true,
    );

    const reload = h.handle({ type: 'browser.reload', appSessionId: 'app-b2' });
    const timedOutRequest = nativeRequest();
    assert.ok(timedOutRequest);
    timeouts.fireCurrent();
    await reload;
    assert.equal(browserError(/DROIDEX browser did not respond to reload within \d+ms\./), true);

    const eventCountBeforeLateResult = h.events.length;
    await h.handle({
      type: 'browser.native.result',
      result: nativeSuccess(timedOutRequest, nativeSnapshot('https://example.test/reloaded')),
    });
    assert.equal(h.events.length, eventCountBeforeLateResult);

    const close = h.handle({ type: 'browser.close', appSessionId: 'app-b2' });
    const closeRequest = nativeRequest();
    assert.ok(closeRequest);
    await h.handle({ type: 'browser.native.result', result: nativeSuccess(closeRequest) });
    await close;
  } finally {
    await h.dispose();
    timeouts.restore();
  }
});
