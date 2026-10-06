import assert from 'node:assert/strict';
import { mkdtemp, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { ReasoningEffort, type McpServerConfig } from '@factory/droid-sdk';
import type { HistoricalSession } from './history.js';
import type {
  FactoryDefaultSettings,
  PermissionOutcome,
  ServerEvent,
  SessionSummary,
  TranscriptEvent,
} from './protocol.js';
import { SessionModelSettings } from './SessionModelSettings.js';
import type { DelegatedTurnEnd, Provider, ProviderResumeInput } from './providers/session.js';
import { runPrimaryTurn } from './providers/primaryTurn.js';
import { SessionEventFlow } from './SessionEventFlow.js';
import { DroidProvider } from './providers/droid/DroidProvider.js';
import { DroidProviderSession } from './providers/droid/DroidProviderSession.js';
import type { ProviderQuestionAnswers } from './providers/interactions.js';
import {
  SessionLifecycle,
  type LiveSession,
  type SessionCreateCommand,
  type SessionLifecycleDependencies,
} from './SessionLifecycle.js';
import { SessionRegistry } from './SessionRegistry.js';
import {
  FakeFactoryRuntime,
  FakeFactorySession,
  type RecordedCall,
} from './testing/fakeFactoryRuntime.js';

class TestHistory {
  readonly persisted: SessionSummary[] = [];
  readonly patches = new Map<string, Partial<SessionSummary>>();
  readonly hidden = new Set<string>();
  nextSyncError?: Error;
  constructor(private readonly calls: RecordedCall[]) {}
  syncSummaries(summaries: SessionSummary[]): boolean | undefined {
    const error = this.nextSyncError;
    delete this.nextSyncError;
    if (error) throw error;
    this.persisted.push(...summaries.map((summary) => ({ ...summary })));
    this.calls.push({ target: 'history', method: 'syncSummaries', args: summaries });
    return undefined;
  }
  summaryPatchesAndHidden(): {
    patches: Map<string, Partial<SessionSummary>>;
    hiddenProviderSessionIds: Set<string>;
  } {
    return { patches: this.patches, hiddenProviderSessionIds: this.hidden };
  }
}

class RejectingInterruptSession extends FakeFactorySession {
  override interrupt(): Promise<void> {
    return super.interrupt().then(() => {
      throw new Error('interrupt rejected');
    });
  }
}

class CallbackCloseSession extends FakeFactorySession {
  constructor(
    sessionId: string,
    calls: RecordedCall[],
    private readonly afterClose: () => Promise<void>,
  ) {
    super(sessionId, {}, calls);
  }

  override async close(): Promise<void> {
    await super.close();
    await this.afterClose();
  }
}

class RejectingCloseSession extends FakeFactorySession {
  override async close(): Promise<void> {
    await super.close();
    throw new Error(`close failed: ${this.sessionId}`);
  }
}

function createHarness(
  ordinarySummaries: SessionSummary[] = [],
  beforeFirstTurn?: (session: SessionSummary, clientRef: string) => Promise<void>,
  overrides: Partial<SessionLifecycleDependencies> = {},
) {
  const calls: RecordedCall[] = [];
  const events: ServerEvent[] = [];
  const publicationRegistration: boolean[] = [];
  const forgettingAfterUnregister: boolean[] = [];
  const eventFlowForgettingAfterUnregister: boolean[] = [];
  const missionForgettingAfterUnregister: boolean[] = [];
  const history = new TestHistory(calls);
  const runtime = new FakeFactoryRuntime(calls);
  let provider: Provider = new DroidProvider(runtime, () => undefined);
  let projection: Partial<SessionSummary> = {};
  let waitForSettings = (): Promise<void> => Promise.resolve();
  let applyPending: (appSessionId: string) => Promise<boolean> = () => Promise.resolve(true);
  let enableAutoCompaction = (): Promise<boolean> => Promise.resolve(true);
  let compactionLimit = (): Promise<number> => Promise.resolve(800);
  let shutdownStarted = false;
  let pendingInteractions = false;
  let capacityReleases = 0;
  let closeChildren: (appSessionId: string) => Promise<void> = () => Promise.resolve();
  let killProcesses: (appSessionId: string) => Promise<void> = () => Promise.resolve();
  let emitSessionList: (closedProviderSessionId: string) => void | Promise<void> = () =>
    recordEvent({ type: 'sessions.list', ...registry.listSummaries() });
  let nextEmitFailure: { type: ServerEvent['type']; error: Error } | undefined;
  let now = 10_000;
  let mcpId = 0;
  let mcpConfigs: McpServerConfig[] = [];
  const historical = (): HistoricalSession[] =>
    ordinarySummaries.map((item) => ({ summary: { ...item }, progress: [] }));
  const recordEvent = (event: ServerEvent): void => {
    if (nextEmitFailure?.type === event.type) {
      const error = nextEmitFailure.error;
      nextEmitFailure = undefined;
      throw error;
    }
    events.push(event);
    calls.push({ target: 'protocol', method: event.type, args: [event] });
    if (event.type === 'session.created' || event.type === 'session.updated') {
      publicationRegistration.push(registry.getLive(event.session.appSessionId) !== undefined);
    }
  };
  const registry = new SessionRegistry<LiveSession>({
    history,
    loadOrdinarySessions: historical,
    loadMissionControlSessions: () => [],
    projectSummary: (item) => ({ ...item, ...projection }),
    onSummaryUpdated: (session) => recordEvent({ type: 'session.updated', session }),
    now: () => {
      now += 1;
      return now;
    },
  });
  const defaults: FactoryDefaultSettings = {
    modelId: 'model-default',
    reasoningEffort: ReasoningEffort.Low,
    autonomy: 'low',
    interactionMode: 'auto',
  };
  const record = (target: RecordedCall['target'], method: string, ...args: unknown[]): void => {
    calls.push({ target, method, args });
  };
  const lifecycle = new SessionLifecycle({
    beforeFirstTurn,
    eventFlow: { apply: () => undefined, beginTurn: () => undefined },
    settleStreaming: async () => {
      calls.push({ target: 'cleanup', method: 'timeline.settleStreaming', args: [] });
    },
    releaseRuntimeForCapacity: async () => false,
    provider: () => provider,
    registry,
    ensureConnected: () => record('runtime', 'ensureConnected'),
    getFactoryDefaults: () => Promise.resolve(defaults),
    maxContextTokensForModel: () => 1_000,
    childSessions: {
      retryAgentWave: (appSessionId) => record('cleanup', 'children.retryWave', appSessionId),
      attachParent: (appSessionId) => record('cleanup', 'children.attach', appSessionId),
      closeParent: (appSessionId) => closeChildren(appSessionId),
    },
    startLocalMcpServers: () => {
      const resourceId = ++mcpId;
      record('runtime', 'mcp.start', resourceId);
      const close = () => {
        record('cleanup', 'mcp.close', `mcp-${resourceId}`);
        return Promise.resolve();
      };
      return Promise.resolve({ servers: [{ close }], configs: mcpConfigs });
    },
    interactionsFor: () => ({
      requestApproval: () => new Promise<PermissionOutcome>(() => undefined),
      requestQuestion: () => new Promise<ProviderQuestionAnswers>(() => undefined),
      cancelPending: () => undefined,
      isActive: () => true,
    }),
    compaction: {
      resolveLimit: () => compactionLimit(),
      arm: async (target, limit) => {
        if (!target.isCurrent()) return false;
        record('provider', 'autoCompaction.arm', target.session.sessionId, limit);
        const armed = await enableAutoCompaction();
        return target.isCurrent() && armed;
      },
      subscribePrimary: (target) => {
        target.liveSession.unsubscribe = target.session.onNotification(() => undefined);
      },
      afterTurn: (target) => record('cleanup', 'autoCompaction.settled', target.appSessionId),
      cancel: (target) => {
        if (target.kind === 'primary') target.liveSession.autoCompacting = false;
        else target.setAutoCompacting(false);
        const id = target.kind === 'primary' ? target.appSessionId : target.childSessionId;
        record('cleanup', 'watchdog.clear', id);
      },
      forgetSession: (appSessionId) => record('cleanup', 'compaction.forgetSession', appSessionId),
    },
    isShutdownStarted: () => shutdownStarted,
    agentProcesses: {
      setIgnoredCommands: (appSessionId, patterns) =>
        record('runtime', 'processes.setIgnoredCommands', appSessionId, ...patterns),
      track: (appSessionId, pid) => record('runtime', 'processes.track', appSessionId, pid),
      untrack: (pid) => record('cleanup', 'processes.untrack', pid),
      killSession: (appSessionId) => {
        record('cleanup', 'processes.killSession', appSessionId);
        return killProcesses(appSessionId);
      },
    },
    hasActiveSettingsChanges: () => false,
    waitForSettingsMutations: () => waitForSettings(),
    applyPendingSettingsToSummary: (item) => ({ ...item, ...projection }),
    recordLineage: () => undefined,
    applyPendingSessionSettings: (appSessionId) => applyPending(appSessionId),
    runPrimaryTurn: async (live, { prompt, delivery }) => {
      if (delivery && !delivery.isCurrent()) return;
      for await (const event of live.session.stream(prompt)) {
        delivery?.accepted();
        void event;
      }
      delivery?.accepted();
    },
    context: {
      preserveUsage: () => undefined,
      refresh: (target) => {
        record('provider', 'context.refresh', target.sourceSessionId);
        return Promise.resolve();
      },
      stopPolling: (sourceSessionId) => record('cleanup', 'poll.stop', sourceSessionId),
      stopSession: (live) => {
        record('cleanup', 'poll.stop', live.summary.appSessionId);
        if (live.summary.providerSessionId)
          record('cleanup', 'poll.stop', live.summary.providerSessionId);
      },
      forgetSession: (live) => record('cleanup', 'runtimeCaches.clear', live.summary.appSessionId),
    },
    openProviderTranscript: () => {},
    forgetProviderTranscript: () => {},
    hasPendingInteractions: () => pendingInteractions,
    onScheduledCapacityChanged: () => {
      capacityReleases += 1;
    },
    forgetInteractions: (appSessionId) => {
      forgettingAfterUnregister.push(registry.getLive(appSessionId) === undefined);
      record('cleanup', 'interactions.forget', appSessionId);
    },
    forgetEventFlow: (appSessionId) => {
      eventFlowForgettingAfterUnregister.push(registry.getLive(appSessionId) === undefined);
      record('cleanup', 'eventFlow.forget', appSessionId);
    },
    forgetMissionControl: (appSessionId) => {
      missionForgettingAfterUnregister.push(registry.getLive(appSessionId) === undefined);
      record('cleanup', 'missionControl.forget', appSessionId);
    },
    forgetPendingSettings: (appSessionId) =>
      record('cleanup', 'pendingSettings.forget', appSessionId),
    closeBrowserSession: (appSessionId) => {
      record('browser', 'browser.close', appSessionId);
      return Promise.resolve();
    },
    stopVoiceSession: (appSessionId) => {
      record('cleanup', 'voice.stop', appSessionId);
      return Promise.resolve();
    },
    emit: recordEvent,
    emitError: (error) => recordEvent({ type: 'error', ...error }),
    appendProgress: (appSessionId, text) => record('protocol', 'progress', appSessionId, text),
    appendError: (appSessionId, message) => record('protocol', 'error', appSessionId, message),
    appendSteer: (appSessionId, text) => record('protocol', 'appendSteer', appSessionId, text),
    catalogUpdated: () => undefined,
    emitSessionList: (closedProviderSessionId) => emitSessionList(closedProviderSessionId),
    ...overrides,
  });

  return {
    calls,
    events,
    history,
    runtime,
    registry,
    lifecycle,
    publicationRegistration,
    forgettingAfterUnregister,
    eventFlowForgettingAfterUnregister,
    missionForgettingAfterUnregister,
    capacityReleases: () => capacityReleases,
    setPendingInteractions: (pending: boolean) => {
      pendingInteractions = pending;
    },
    setProjection: (patch: Partial<SessionSummary>) => {
      projection = { ...patch };
    },
    setProvider: (next: Provider) => {
      provider = next;
    },
    setSettingsWait: (wait: () => Promise<void>) => {
      waitForSettings = wait;
    },
    setPendingApply: (action: (appSessionId: string) => Promise<boolean>) => {
      applyPending = action;
    },
    setEnableAutoCompaction: (action: () => Promise<boolean>) => {
      enableAutoCompaction = action;
    },
    setCompactionLimit: (action: () => Promise<number>) => {
      compactionLimit = action;
    },
    setEmitSessionList: (action: (closedProviderSessionId: string) => void | Promise<void>) => {
      emitSessionList = action;
    },
    setShutdownStarted: (started: boolean) => {
      shutdownStarted = started;
    },
    setChildCloser: (action: (appSessionId: string) => Promise<void>) => {
      closeChildren = action;
    },
    setProcessKiller: (action: (appSessionId: string) => Promise<void>) => {
      killProcesses = action;
    },
    setMcpConfigs: (configs: McpServerConfig[]) => {
      mcpConfigs = configs;
    },
    failNextEmit: (type: ServerEvent['type'], error: Error) => {
      nextEmitFailure = { type, error };
    },
  };
}

type Harness = ReturnType<typeof createHarness>;

function summary(
  appSessionId: string,
  providerSessionId = appSessionId,
  patch: Partial<SessionSummary> = {},
): SessionSummary {
  return {
    appSessionId,
    providerSessionId,
    provider: 'droid',
    sessionPurpose: 'chat',
    interactionMode: 'auto',
    role: 'user',
    title: appSessionId,
    goal: 'test',
    cwd: '/workspace',
    workspaceKind: 'folder',
    modelId: 'model-default',
    reasoningEffort: ReasoningEffort.Low,
    autonomy: 'low',
    phase: 'paused',
    features: [],
    tokensIn: 0,
    tokensOut: 0,
    contextTokens: 0,
    createdAt: 1,
    updatedAt: 1,
    ...patch,
  };
}

function createCommand(goal = 'first'): SessionCreateCommand {
  return {
    type: 'session.create',
    clientRef: 'client-1',
    title: 'Test session',
    goal,
    cwd: '/workspace',
    sessionPurpose: 'chat',
    interactionMode: 'auto',
    autonomy: 'low',
  };
}

function queueCreate(harness: Harness, sessionId: string): FakeFactorySession {
  const session = new FakeFactorySession(sessionId, {}, harness.calls);
  harness.runtime.createQueue.push(session);
  return session;
}

function queueLoad(
  harness: Harness,
  providerSessionId: string,
  session: FakeFactorySession = new FakeFactorySession(providerSessionId, {}, harness.calls),
): FakeFactorySession {
  harness.runtime.loadQueue.set(providerSessionId, [session]);
  return session;
}

function requireLive(harness: Harness, id: string): LiveSession {
  const live = harness.registry.getLive(id);
  assert.ok(live);
  return live;
}

function interruptCount(harness: Harness): number {
  return harness.calls.filter((call) => call.target === 'provider' && call.method === 'interrupt')
    .length;
}

function turnGate() {
  let resolve: () => void = () => undefined;
  const promise = new Promise<void>((finish) => {
    resolve = finish;
  });
  return { promise, resolve: () => resolve() };
}

test('create and cold resume publish only after registration', async () => {
  const created = createHarness();
  const createdProvider = queueCreate(created, 'created-1');
  await created.lifecycle.create(createCommand());
  await createdProvider.waitForPrompts(1);
  const createTrace = created.calls.map((call) => call.method);
  const createPersist = createTrace.indexOf('syncSummaries');
  const createPublished = createTrace.indexOf('session.created');
  assert.ok(createPersist >= 0 && createPersist < createPublished);
  assert.ok(createPublished < createTrace.indexOf('stream'));
  assert.equal(created.registry.getCanonicalSummary('created-1')?.appSessionId, 'created-1');
  assert.equal(created.runtime.createCalls[0]?.cwd, '/workspace');
  assert.equal(created.publicationRegistration.every(Boolean), true);
  const resumed = createHarness([summary('app-2', 'provider-2')]);
  queueLoad(resumed, 'provider-2');
  await resumed.lifecycle.resume('app-2');

  const resumeTrace = resumed.calls.map((call) => call.method);
  assert.deepEqual(
    resumeTrace.filter((method) =>
      ['loadSession', 'autoCompaction.arm', 'onNotification', 'syncSummaries'].includes(method),
    ),
    // The Droid session's own listener, then the compaction subscription.
    ['loadSession', 'onNotification', 'autoCompaction.arm', 'onNotification', 'syncSummaries'],
  );
  assert.deepEqual(
    resumed.events.slice(-2).map((event) => event.type),
    ['session.created', 'session.updated'],
  );
  assert.equal(resumed.runtime.loadCalls[0]?.handlers.cwd, '/workspace');
  assert.equal(resumed.publicationRegistration.every(Boolean), true);
});

test('folder-less chats run and resume in the DROIDEX chats directory', async (t) => {
  const userDataDir = await mkdtemp(join(tmpdir(), 'droidex-user-data-'));
  const previousUserDataDir = process.env.DROIDEX_USER_DATA_DIR;
  process.env.DROIDEX_USER_DATA_DIR = userDataDir;
  t.after(async () => {
    if (previousUserDataDir === undefined) delete process.env.DROIDEX_USER_DATA_DIR;
    else process.env.DROIDEX_USER_DATA_DIR = previousUserDataDir;
    await rm(userDataDir, { recursive: true, force: true });
  });

  const harness = createHarness();
  const provider = queueCreate(harness, 'plain-chat');
  await harness.lifecycle.create({ ...createCommand(), cwd: '' });
  await provider.waitForPrompts(1);

  const chatCwd = join(userDataDir, 'chats');
  assert.equal(harness.runtime.createCalls[0]?.cwd, chatCwd);
  assert.equal((await stat(chatCwd)).isDirectory(), true);
  assert.deepEqual(
    harness.registry.getCanonicalSummary('plain-chat') && {
      cwd: harness.registry.getCanonicalSummary('plain-chat')?.cwd,
      workspaceKind: harness.registry.getCanonicalSummary('plain-chat')?.workspaceKind,
    },
    { cwd: '', workspaceKind: 'none' },
  );

  const resumed = createHarness([
    summary('old-chat', 'provider-old', { cwd: '', workspaceKind: 'none' }),
  ]);
  queueLoad(resumed, 'provider-old');
  await resumed.lifecycle.resume('old-chat');
  assert.equal(resumed.runtime.loadCalls[0]?.handlers.cwd, chatCwd);
});

test('create omits an unarmed daemon compaction limit from its summary', async () => {
  const harness = createHarness();
  const provider = queueCreate(harness, 'unarmed-create');
  harness.setEnableAutoCompaction(() => Promise.resolve(false));

  await harness.lifecycle.create(createCommand());
  await provider.waitForPrompts(1);

  const created = harness.events.find(
    (event) => event.type === 'session.created' && event.session.appSessionId === 'unarmed-create',
  );
  assert.equal(created?.type, 'session.created');
  assert.equal(created.session.compactionTokenLimit, undefined);
  assert.equal(
    harness.registry.getCanonicalSummary('unarmed-create')?.compactionTokenLimit,
    undefined,
  );
  assert.equal(
    harness.calls.some(
      (call) =>
        call.method === 'autoCompaction.arm' &&
        call.args[0] === 'unarmed-create' &&
        call.args[1] === 800,
    ),
    true,
  );
});

function openedResourceCloses(harness: Harness): unknown[][] {
  return harness.calls
    .filter((call) => call.method === 'mcp.close' || call.method === 'session.close')
    .map((call) => [call.method, call.args[0]]);
}

test('a create or resume that fails at any stage closes what it opened and publishes nothing', async () => {
  const unopened = createHarness();
  unopened.runtime.createQueue.push(new Error('create failed'));
  await unopened.lifecycle.create(createCommand());
  assert.deepEqual(openedResourceCloses(unopened), [['mcp.close', 'mcp-1']]);
  assert.equal(unopened.history.persisted.length, 0);
  assert.equal(
    unopened.events.some((event) => event.type === 'session.created'),
    false,
  );
  assert.equal(
    unopened.events.some(
      (event) =>
        event.type === 'error' &&
        event.code === 'session.create_failed' &&
        event.clientRef === 'client-1' &&
        event.message === 'create failed',
    ),
    true,
  );

  const created = createHarness();
  queueCreate(created, 'failed-create');
  created.setEnableAutoCompaction(() => Promise.reject(new Error('create setup failed')));
  await created.lifecycle.create(createCommand());
  assert.deepEqual(openedResourceCloses(created), [
    ['mcp.close', 'mcp-1'],
    ['session.close', 'failed-create'],
  ]);
  assert.equal(created.registry.getLive('failed-create'), undefined);

  const resumed = createHarness([summary('failed-resume-app', 'failed-resume-provider')]);
  queueLoad(resumed, 'failed-resume-provider');
  resumed.setEnableAutoCompaction(() => Promise.reject(new Error('resume setup failed')));
  await resumed.lifecycle.resume('failed-resume-app');
  assert.deepEqual(openedResourceCloses(resumed), [
    ['mcp.close', 'mcp-1'],
    ['session.close', 'failed-resume-provider'],
  ]);
  assert.equal(resumed.registry.getLive('failed-resume-app'), undefined);

  // A registration that cannot persist leaves nothing indexed.
  const unregistered = createHarness();
  queueCreate(unregistered, 'failed-registration');
  unregistered.runtime.processIds.set('failed-registration', 4321);
  unregistered.history.nextSyncError = new Error('persist failed');
  await unregistered.lifecycle.create(createCommand());
  assert.deepEqual(openedResourceCloses(unregistered), [
    ['mcp.close', 'mcp-1'],
    ['session.close', 'failed-registration'],
  ]);
  assert.equal(unregistered.registry.getLive('failed-registration'), undefined);
  assert.equal(
    unregistered.events.some(
      (event) => event.type === 'error' && event.message === 'persist failed',
    ),
    true,
  );
  // Kill-then-untrack, same order as the normal close path: anything the
  // provider spawned before the failure is only reachable while it is alive.
  assert.deepEqual(
    unregistered.calls
      .filter((call) => call.method.startsWith('processes.') && call.method !== 'processes.track')
      .map((call) => call.method),
    ['processes.killSession', 'processes.untrack'],
  );
});

test('post-registration failures retain cleanup ownership through a process outage', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const created = createHarness();
  queueCreate(created, 'failed-create-publication');
  let discoveryFailed = true;
  created.setProcessKiller(async () => {
    if (discoveryFailed) throw new Error('process discovery unavailable');
  });
  created.setChildCloser(async () => {
    created.calls.push({ target: 'cleanup', method: 'children.close', args: [] });
  });
  created.failNextEmit('session.created', new Error('create publication failed'));

  await created.lifecycle.create(createCommand());
  const failedOpen = requireLive(created, 'failed-create-publication');
  assert.equal(failedOpen.closeMode, 'discard-pending');
  assert.equal(
    created.calls.some((call) => call.method === 'session.close'),
    false,
  );
  assert.equal(
    created.calls.some((call) => call.method === 'mcp.close'),
    false,
  );
  discoveryFailed = false;
  t.mock.timers.tick(5000);
  await failedOpen.closePromise;

  assert.deepEqual(
    created.calls
      .map((call) => call.method)
      .filter((method) =>
        ['processes.killSession', 'children.close', 'session.close'].includes(method),
      ),
    ['processes.killSession', 'processes.killSession', 'children.close', 'session.close'],
  );
  assert.equal(created.registry.getLive('failed-create-publication'), undefined);
  assert.deepEqual(
    created.calls
      .filter((call) => ['unsubscribe', 'mcp.close', 'session.close'].includes(call.method))
      .map((call) => [call.method, call.args[0]]),
    [
      ['unsubscribe', 'failed-create-publication'],
      ['mcp.close', 'mcp-1'],
      // The Droid session's own listener goes as the session closes.
      ['unsubscribe', 'failed-create-publication'],
      ['session.close', 'failed-create-publication'],
    ],
  );
  assert.equal(
    created.events.some(
      (event) => event.type === 'error' && event.message === 'create publication failed',
    ),
    true,
  );

  const resumed = createHarness([
    summary('failed-resume-publication-app', 'failed-resume-publication-provider'),
  ]);
  queueLoad(resumed, 'failed-resume-publication-provider');
  resumed.failNextEmit('session.created', new Error('resume publication failed'));

  await resumed.lifecycle.resume('failed-resume-publication-app');

  assert.equal(resumed.registry.getLive('failed-resume-publication-app'), undefined);
  assert.deepEqual(
    resumed.calls
      .filter((call) => ['unsubscribe', 'mcp.close', 'session.close'].includes(call.method))
      .map((call) => [call.method, call.args[0]]),
    [
      ['unsubscribe', 'failed-resume-publication-provider'],
      ['mcp.close', 'mcp-1'],
      ['unsubscribe', 'failed-resume-publication-provider'],
      ['session.close', 'failed-resume-publication-provider'],
    ],
  );
  assert.equal(
    resumed.events.some(
      (event) => event.type === 'error' && event.message === 'resume publication failed',
    ),
    true,
  );
});

test('an eager resume and immediate send share one provider load', async () => {
  const harness = createHarness([summary('warm-app', 'warm-provider')]);
  const provider = queueLoad(harness, 'warm-provider');
  let releaseLimit: (limit: number) => void = () => undefined;
  harness.setCompactionLimit(
    () =>
      new Promise<number>((resolve) => {
        releaseLimit = resolve;
      }),
  );

  const warming = harness.lifecycle.resume('warm-app');
  await new Promise<void>((resolve) => setImmediate(resolve));
  const sending = harness.lifecycle.send('warm-app', 'send while warming');

  assert.equal(harness.runtime.loadCalls.length, 1);
  releaseLimit(800);
  assert.equal(await warming, true);
  await sending;
  assert.deepEqual(provider.prompts, ['send while warming']);
  assert.equal(harness.runtime.loadCalls.length, 1);
});

test('failed lazy resume emits only the original load error', async () => {
  const harness = createHarness([summary('lazy-failure-app', 'lazy-failure-provider')]);
  harness.runtime.loadQueue.set('lazy-failure-provider', [new Error('provider load failed')]);

  await harness.lifecycle.send('lazy-failure-app', 'not delivered');

  assert.deepEqual(
    harness.events
      .filter((event): event is Extract<ServerEvent, { type: 'error' }> => event.type === 'error')
      .map((event) => event.message),
    ['provider load failed'],
  );
});

test('failed turn setup clears streaming so the next send can run', async () => {
  const harness = createHarness();
  const provider = queueCreate(harness, 'setup-recovery');
  await harness.lifecycle.create(createCommand());
  await provider.waitForPrompts(1);
  await new Promise<void>((resolve) => setImmediate(resolve));
  harness.history.nextSyncError = new Error('persist failed');

  await assert.rejects(harness.lifecycle.send('setup-recovery', 'failed setup'), /persist failed/);

  assert.equal(requireLive(harness, 'setup-recovery').streaming, false);
  await harness.lifecycle.send('setup-recovery', 'recovered');
  assert.deepEqual(provider.prompts, ['first', 'recovered']);
});

test('queued sends stay FIFO, and send-now moves a pending steer to the front', async () => {
  const fifo = createHarness();
  const fifoProvider = queueCreate(fifo, 'fifo');
  const fifoGate = fifoProvider.deferNextStream();
  await fifo.lifecycle.create(createCommand('first'));
  await fifoProvider.waitForPrompts(1);
  await fifo.lifecycle.send('fifo', 'second');
  await fifo.lifecycle.send('fifo', 'third');
  fifoGate.resolve();
  await fifoProvider.waitForPrompts(3);
  assert.deepEqual(fifoProvider.prompts, ['first', 'second', 'third']);
  const steered = createHarness();
  const steerProvider = queueCreate(steered, 'steered');
  const steerGate = steerProvider.deferNextStream();
  await steered.lifecycle.create(createCommand('first'));
  await steerProvider.waitForPrompts(1);
  await steered.lifecycle.send('steered', 'queued');
  // Droid takes no steer yet, so both wait on the queue, still pending.
  await steered.lifecycle.send('steered', 'steer one', undefined, 'steer-1');
  await steered.lifecycle.send('steered', 'steer two', undefined, 'steer-2');
  assert.deepEqual(steered.registry.getCanonicalSummary('steered')?.pendingSteers, [
    { id: 'steer-1', text: 'steer one' },
    { id: 'steer-2', text: 'steer two' },
  ]);
  await steered.lifecycle.sendNow('steered', 'steer-2');
  await steered.lifecycle.sendNow('steered', 'steer-1');
  steerGate.resolve();
  await steerProvider.waitForPrompts(4);
  assert.deepEqual(steerProvider.prompts, ['first', 'steer one', 'queued', 'steer two']);
  // The second send-now lands while the first interrupt is still in flight and
  // reorders the queue instead of interrupting the turn that sends it; the
  // rest keeps the order it was sent in.
  assert.equal(interruptCount(steered), 1);
});

test('a prompt from another chat steers the running turn without waiting for it', async () => {
  const harness = createHarness();
  const provider = queueCreate(harness, 'target');
  const gate = provider.deferNextStream();
  await harness.lifecycle.create(createCommand('first'));
  await provider.waitForPrompts(1);
  const always = () => true;
  assert.equal(await harness.lifecycle.steerRunningTurn('unknown', 'nowhere to go', always), false);
  // A prompt the chat could not take is reported, not dropped behind a success.
  harness.setPendingApply(() => Promise.resolve(false));
  assert.equal(
    await harness.lifecycle.steerRunningTurn('target', 'settings failed', always),
    false,
  );
  // A guard that turns false while the chat takes it withdraws it.
  let allowed = true;
  harness.setPendingApply(() => {
    allowed = false;
    return Promise.resolve(true);
  });
  assert.equal(
    await harness.lifecycle.steerRunningTurn('target', 'withdrawn', () => allowed),
    false,
  );
  harness.setPendingApply(() => Promise.resolve(true));

  allowed = true;
  assert.equal(
    await harness.lifecycle.steerRunningTurn('target', 'withdrawn behind the turn', () => allowed),
    true,
  );
  assert.equal(
    await harness.lifecycle.steerRunningTurn('target', 'from another chat', always),
    true,
  );
  // It is pending the way the user's own steer is; Droid takes no steer yet,
  // so it waits behind the turn.
  const pending = () =>
    harness.registry.getCanonicalSummary('target')?.pendingSteers?.map((steer) => steer.text);
  for (let tick = 0; tick < 100 && pending()?.length !== 2; tick += 1)
    await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(pending(), ['withdrawn behind the turn', 'from another chat']);
  assert.equal(interruptCount(harness), 0);

  // A guard that turns false while it waits behind the turn drops it there,
  // and the message behind it still runs.
  allowed = false;
  gate.resolve();
  await provider.waitForPrompts(2);
  assert.deepEqual(provider.prompts, ['first', 'from another chat']);
});

test('send-now queues without interrupting compaction and reports interrupt rejection', async () => {
  const compacting = createHarness();
  const provider = queueCreate(compacting, 'compacting');
  await compacting.lifecycle.create(createCommand());
  await provider.waitForPrompts(1);
  await new Promise<void>((resolve) => setImmediate(resolve));
  const live = requireLive(compacting, 'compacting');
  live.compacting = true;
  await compacting.lifecycle.send('compacting', 'manual', undefined, 'manual');
  await compacting.lifecycle.sendNow('compacting', 'manual');
  live.compacting = false;
  live.autoCompacting = true;
  await compacting.lifecycle.send('compacting', 'automatic', undefined, 'automatic');
  await compacting.lifecycle.sendNow('compacting', 'automatic');
  assert.deepEqual(
    live.pendingSends.map((prompt) => prompt.text),
    ['automatic', 'manual'],
  );
  assert.equal(interruptCount(compacting), 0);
  const rejected = createHarness();
  const rejectingProvider = new RejectingInterruptSession('rejected', {}, rejected.calls);
  const gate = rejectingProvider.deferNextStream();
  rejected.runtime.createQueue.push(rejectingProvider);
  await rejected.lifecycle.create(createCommand());
  await rejectingProvider.waitForPrompts(1);
  await rejected.lifecycle.send('rejected', 'keep queued', undefined, 'steer');
  await rejected.lifecycle.sendNow('rejected', 'steer');
  assert.deepEqual(
    requireLive(rejected, 'rejected').pendingSends.map((prompt) => prompt.text),
    ['keep queued'],
  );
  assert.equal(requireLive(rejected, 'rejected').interruptingToSend, false);
  assert.equal(
    rejected.events.some(
      (event) => event.type === 'error' && event.code === 'session.send_now_failed',
    ),
    true,
  );
  gate.resolve();
  await rejectingProvider.waitForPrompts(2);
});

test('a turn that ends while send-now is stopping it waits for the interrupt before the next prompt', async () => {
  const h = createHarness();
  const provider = queueCreate(h, 'racing');
  const turn = provider.deferNextStream();
  await h.lifecycle.create(createCommand('first'));
  await provider.waitForPrompts(1);
  await h.lifecycle.send('racing', 'urgent', undefined, 'urgent');
  const interrupt = provider.deferNextInterrupt();
  const sending = h.lifecycle.sendNow('racing', 'urgent');
  // The turn finishes on its own before the harness acknowledges the
  // interrupt, which would otherwise land on the turn started next.
  turn.resolve();
  for (let tick = 0; tick < 20; tick += 1) await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(provider.prompts, ['first']);
  interrupt.resolve();
  await sending;
  await provider.waitForPrompts(2);
  assert.deepEqual(provider.prompts, ['first', 'urgent']);
});

test('a steer is pending until the harness delivers it, and one refused late still runs', async () => {
  const h = createHarness();
  const provider = queueCreate(h, 'steer');
  const gate = provider.deferNextStream();
  await h.lifecycle.create(createCommand('first'));
  await provider.waitForPrompts(1);
  const live = requireLive(h, 'steer');
  const deliveries: ((delivered: boolean) => void)[] = [];
  live.session.steer = () =>
    new Promise<boolean>((settle) => {
      deliveries.push(settle);
    });
  const harnessHas = async (count: number) => {
    while (deliveries.length < count) await new Promise((resolve) => setImmediate(resolve));
  };
  const pendingSteers = () => h.registry.getCanonicalSummary('steer')?.pendingSteers;

  const delivered = h.lifecycle.send('steer', 'delivered', undefined, 'steer-1');
  await harnessHas(1);
  assert.deepEqual(pendingSteers(), [{ id: 'steer-1', text: 'delivered' }]);
  deliveries[0](true);
  await delivered;
  assert.deepEqual(pendingSteers(), []);
  assert.deepEqual(
    h.calls.filter((call) => call.method === 'appendSteer').map((call) => call.args),
    [['steer', 'delivered']],
  );

  // A refusal that lands after the turn settled still runs as the next turn.
  const late = h.lifecycle.send('steer', 'late', undefined, 'steer-2');
  await harnessHas(2);
  const nextGate = provider.deferNextStream();
  gate.resolve();
  while (live.streaming) await new Promise((resolve) => setImmediate(resolve));
  deliveries[1](false);
  await provider.waitForPrompts(2);
  assert.deepEqual(provider.prompts, ['first', 'late']);
  assert.equal(interruptCount(h), 0);

  // Send now takes a steer back and stops the turn, but the harness delivers
  // it first: it is not sent again.
  const raced = h.lifecycle.send('steer', 'raced', undefined, 'steer-3');
  await harnessHas(3);
  await h.lifecycle.sendNow('steer', 'steer-3');
  deliveries[2](true);
  await raced;
  assert.deepEqual(live.pendingSends, []);
  assert.equal(interruptCount(h), 1);
  nextGate.resolve();
  await late;
});

test('a turn persists recent activity at start and completion while queued sends leave it alone', async () => {
  // Recency survives a restart mid-turn; streaming suppresses unread until
  // the response completes.
  const harness = createHarness();
  const provider = queueCreate(harness, 'touch');
  await harness.lifecycle.create(createCommand());
  await provider.waitForPrompts(1);
  await new Promise<void>((resolve) => setImmediate(resolve));
  const before = harness.registry.getCanonicalSummary('touch')?.updatedAt;
  assert.ok(before !== undefined);

  const gate = provider.deferNextStream();
  const sending = harness.lifecycle.send('touch', 'second');
  await provider.waitForPrompts(2);
  const mid = harness.registry.getCanonicalSummary('touch');
  assert.equal(mid?.streaming, true);
  assert.ok(mid !== undefined && mid.updatedAt > before);
  assert.equal(harness.history.persisted.at(-1)?.updatedAt, mid.updatedAt);

  await harness.lifecycle.send('touch', 'queued one');
  await harness.lifecycle.send('touch', 'queued two');
  const queued = harness.registry.getCanonicalSummary('touch');
  assert.equal(queued?.queuedSends, 2);
  assert.equal(queued?.updatedAt, mid.updatedAt);

  gate.resolve();
  await sending;
  await provider.waitForPrompts(4);
  const after = harness.registry.getCanonicalSummary('touch');
  assert.ok(after !== undefined && after.updatedAt > mid.updatedAt);
});

test('interrupt handles idle, streaming, manual compaction, and auto-compaction states', async () => {
  const harness = createHarness();
  const provider = queueCreate(harness, 'stop');
  await harness.lifecycle.create(createCommand());
  await provider.waitForPrompts(1);
  await new Promise<void>((resolve) => setImmediate(resolve));
  const live = requireLive(harness, 'stop');
  await harness.lifecycle.interrupt('stop');
  assert.equal(interruptCount(harness), 1);
  assert.equal(live.interrupting, false);
  live.streaming = true;
  await harness.lifecycle.interrupt('stop');
  assert.equal(interruptCount(harness), 2);
  assert.equal(live.interrupting, true);
  live.streaming = false;
  live.interrupting = false;
  live.compacting = true;
  live.pendingSends = [{ text: 'drop', order: 0 }];
  await harness.lifecycle.interrupt('stop');
  assert.equal(interruptCount(harness), 2);
  assert.deepEqual(live.pendingSends, []);
  live.compacting = false;
  live.autoCompacting = true;
  await harness.lifecycle.interrupt('stop');
  assert.equal(interruptCount(harness), 3);
  assert.equal(live.autoCompacting, false);
  assert.equal(
    harness.calls.some((call) => call.method === 'watchdog.clear' && call.args[0] === 'stop'),
    true,
  );

  const rejected = createHarness();
  const rejectingProvider = new RejectingInterruptSession('rejected-stop', {}, rejected.calls);
  rejected.runtime.createQueue.push(rejectingProvider);
  await rejected.lifecycle.create(createCommand());
  await rejectingProvider.waitForPrompts(1);
  await new Promise<void>((resolve) => setImmediate(resolve));
  const rejectedLive = requireLive(rejected, 'rejected-stop');
  rejectedLive.autoCompacting = true;
  await assert.rejects(rejected.lifecycle.interrupt('rejected-stop'), /interrupt rejected/);
  assert.equal(rejectedLive.interrupting, false);
  assert.equal(rejectedLive.autoCompacting, true);
  assert.equal(
    rejected.calls.some(
      (call) => call.method === 'watchdog.clear' && call.args[0] === 'rejected-stop',
    ),
    false,
  );

  const aliased = createHarness([summary('stable-stop', 'provider-stop')]);
  queueLoad(aliased, 'provider-stop');
  await aliased.lifecycle.resume('stable-stop');
  const aliasedLive = requireLive(aliased, 'provider-stop');
  aliasedLive.autoCompacting = true;
  aliased.calls.length = 0;
  await aliased.lifecycle.interrupt('provider-stop');
  assert.equal(
    aliased.calls.some(
      (call) => call.method === 'watchdog.clear' && call.args[0] === 'stable-stop',
    ),
    true,
  );
});

test('resuming an already-live session does not reload or persist it', async () => {
  const harness = createHarness();
  const provider = queueCreate(harness, 'live');
  await harness.lifecycle.create(createCommand());
  await provider.waitForPrompts(1);
  await new Promise<void>((resolve) => setImmediate(resolve));
  harness.calls.length = 0;
  harness.events.length = 0;
  harness.history.persisted.length = 0;
  await harness.lifecycle.resume('live');
  assert.equal(harness.runtime.loadCalls.length, 0);
  assert.equal(harness.history.persisted.length, 0);
  assert.deepEqual(
    harness.events.map((event) => event.type),
    ['session.created'],
  );
  assert.equal(harness.calls.filter((call) => call.method === 'context.refresh').length, 1);
  assert.deepEqual(
    harness.calls
      .filter((call) =>
        [
          'mcp.start',
          'loadSession',
          'autoCompaction.arm',
          'onNotification',
          'syncSummaries',
        ].includes(call.method),
      )
      .map((call) => call.method),
    [],
  );
});

test('create and resume abandon in-flight opens when shutdown admission closes', async () => {
  const creating = createHarness();
  let releaseCreateLimit: (limit: number) => void = () => undefined;
  creating.setCompactionLimit(
    () =>
      new Promise<number>((resolve) => {
        releaseCreateLimit = resolve;
      }),
  );
  const create = creating.lifecycle.create(createCommand());
  await new Promise<void>((resolve) => setImmediate(resolve));
  creating.setShutdownStarted(true);
  releaseCreateLimit(800);
  await create;
  assert.equal(creating.runtime.createCalls.length, 0);
  assert.equal(creating.registry.liveSessionsSnapshot().length, 0);
  assert.equal(creating.calls.filter((call) => call.method === 'autoCompaction.arm').length, 0);
  assert.equal(
    creating.events.some((event) => event.type === 'error'),
    false,
  );

  const historical = summary('resume-stable', 'resume-provider');
  const resuming = createHarness([historical]);
  const provider = queueLoad(resuming, 'resume-provider');
  let releaseResumeLimit: (limit: number) => void = () => undefined;
  resuming.setCompactionLimit(
    () =>
      new Promise<number>((resolve) => {
        releaseResumeLimit = resolve;
      }),
  );
  const resume = resuming.lifecycle.resume('resume-stable');
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(resuming.runtime.loadCalls.length, 1);
  resuming.setShutdownStarted(true);
  releaseResumeLimit(800);
  assert.equal(await resume, false);
  assert.equal(resuming.registry.liveSessionsSnapshot().length, 0);
  assert.equal(resuming.calls.filter((call) => call.method === 'autoCompaction.arm').length, 0);
  assert.equal(
    resuming.calls.filter(
      (call) => call.method === 'session.close' && call.args[0] === provider.sessionId,
    ).length,
    1,
  );
  assert.equal(
    resuming.events.some((event) => event.type === 'error'),
    false,
  );
});

test('failed process cleanup preserves the provider and allows closing to retry', async () => {
  const h = createHarness([summary('owned')]);
  queueLoad(h, 'owned');
  await h.lifecycle.resume('owned');
  const live = requireLive(h, 'owned');
  h.calls.length = 0;
  h.setProcessKiller(() => Promise.reject(new Error('ps unavailable')));

  await assert.rejects(h.lifecycle.close('owned'), /ps unavailable/);
  assert.equal(h.registry.getLive('owned'), live);
  assert.equal(live.closeMode, undefined);
  assert.equal(live.closePromise, undefined);
  assert.equal(
    h.calls.some((call) => call.method === 'session.close'),
    false,
  );
  await assert.rejects(h.lifecycle.closeAll(), /ps unavailable/);
  assert.equal(h.calls.filter((call) => call.method === 'processes.killSession').length, 2);
  assert.equal(h.registry.getLive('owned'), live);

  h.setProcessKiller(() => Promise.resolve());
  await h.lifecycle.close('owned');
  assert.equal(h.registry.getLive('owned'), undefined);
  assert.equal(h.calls.filter((call) => call.method === 'session.close').length, 1);
});

test('close follows ownership order and closeAll closes its initial snapshot', async () => {
  const harness = createHarness();
  const provider = new CallbackCloseSession('owner', harness.calls, () => {
    assert.ok(harness.registry.getLive('owner'));
    return Promise.resolve();
  });
  harness.runtime.createQueue.push(provider);
  await harness.lifecycle.create(createCommand());
  await provider.waitForPrompts(1);
  await new Promise<void>((resolve) => setImmediate(resolve));
  requireLive(harness, 'owner');
  const child = new FakeFactorySession('child', {}, harness.calls);
  const unsubscribeChild = child.onNotification(() => undefined);
  harness.setChildCloser(async () => {
    unsubscribeChild();
    await child.close();
  });
  harness.calls.length = 0;
  await harness.lifecycle.close('owner');
  const closeTrace = harness.calls
    .filter((call) =>
      [
        'unsubscribe',
        'session.close',
        'mcp.close',
        'browser.close',
        'compaction.forgetSession',
        'runtimeCaches.clear',
      ].includes(call.method),
    )
    .map((call) => `${call.method}:${String(call.args[0] ?? '')}`);
  assert.deepEqual(closeTrace, [
    'unsubscribe:child',
    'session.close:child',
    'compaction.forgetSession:owner',
    'unsubscribe:owner',
    'mcp.close:mcp-1',
    'unsubscribe:owner',
    'session.close:owner',
    'browser.close:owner',
    'runtimeCaches.clear:owner',
  ]);
  assert.deepEqual(harness.forgettingAfterUnregister, [true]);
  assert.deepEqual(harness.eventFlowForgettingAfterUnregister, [true]);
  assert.deepEqual(harness.missionForgettingAfterUnregister, [true]);
  assert.equal(harness.registry.getLive('owner'), undefined);
  assert.ok(
    harness.calls.findIndex((call) => call.method === 'missionControl.forget') <
      harness.calls.findIndex((call) => call.method === 'session.closed'),
  );
  assert.ok(
    harness.calls.findIndex((call) => call.method === 'pendingSettings.forget') <
      harness.calls.findIndex((call) => call.method === 'session.closed'),
  );
  const ownerList = harness.events.findLast((event) => event.type === 'sessions.list');
  assert.equal(
    ownerList?.sessions.some((session) => session.appSessionId === 'owner'),
    false,
  );

  const all = createHarness();
  let registerLate = (): Promise<void> => Promise.resolve();
  const first = new CallbackCloseSession('first', all.calls, () => registerLate());
  all.runtime.createQueue.push(first);
  const second = queueCreate(all, 'second');
  await all.lifecycle.create(createCommand());
  await first.waitForPrompts(1);
  await all.lifecycle.create(createCommand());
  await second.waitForPrompts(1);
  await new Promise<void>((resolve) => setImmediate(resolve));
  registerLate = async () => {
    const late = queueCreate(all, 'late');
    await all.lifecycle.create(createCommand());
    await late.waitForPrompts(1);
  };
  await all.lifecycle.closeAll();
  assert.deepEqual(
    all.calls.filter((call) => call.method === 'session.close').map((call) => call.args[0]),
    ['first', 'second'],
  );
  assert.deepEqual(
    all.registry.liveSessionsSnapshot().map((session) => session.summary.appSessionId),
    ['late'],
  );
  await all.lifecycle.closeAll();
  assert.equal(all.registry.liveSessionsSnapshot().length, 0);
});

test('closeAll kills every session in one pass before the serialized closes', async () => {
  const h = createHarness();
  const first = queueCreate(h, 'first');
  await h.lifecycle.create(createCommand());
  await first.waitForPrompts(1);
  const second = queueCreate(h, 'second');
  await h.lifecycle.create(createCommand());
  await second.waitForPrompts(1);
  await new Promise<void>((resolve) => setImmediate(resolve));
  h.calls.length = 0;

  await h.lifecycle.closeAll();

  // Shutdown is on a budget the sidecar force-exits: the kill grace has to be
  // paid once for all sessions, not once per session. Each close still kills
  // its own (a single close has no other owner), which is a no-op by then.
  assert.deepEqual(
    h.calls
      .filter((call) => call.method === 'processes.killSession' || call.method === 'session.close')
      .map(
        (call) => `${call.method === 'session.close' ? 'close' : 'kill'}:${String(call.args[0])}`,
      ),
    ['kill:first', 'kill:second', 'kill:first', 'close:first', 'kill:second', 'close:second'],
  );
});

test('close waits for the authoritative post-close session list', async () => {
  const harness = createHarness();
  const provider = queueCreate(harness, 'await-list');
  await harness.lifecycle.create(createCommand());
  await provider.waitForPrompts(1);

  let releaseList = (): void => undefined;
  const listReady = new Promise<void>((resolve) => {
    releaseList = resolve;
  });
  harness.setEmitSessionList(() => listReady);

  let closed = false;
  const closing = harness.lifecycle.close('await-list').then(() => {
    closed = true;
  });
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(closed, false);

  releaseList();
  await closing;
  assert.equal(closed, true);
});

test('closeAll marks its full snapshot before sequential cleanup', async () => {
  const harness = createHarness();
  let releaseFirst = (): void => undefined;
  const first = new CallbackCloseSession(
    'first-marked',
    harness.calls,
    () =>
      new Promise<void>((resolve) => {
        releaseFirst = resolve;
      }),
  );
  const second = new FakeFactorySession('second-marked', {}, harness.calls);
  harness.runtime.createQueue.push(first, second);
  await harness.lifecycle.create(createCommand());
  await first.waitForPrompts(1);
  await harness.lifecycle.create(createCommand());
  await second.waitForPrompts(1);
  await new Promise<void>((resolve) => setImmediate(resolve));

  const closingAll = harness.lifecycle.closeAll();
  await new Promise<void>((resolve) => setImmediate(resolve));
  const firstLive = harness.registry.getLive('first-marked');
  const secondLive = harness.registry.getLive('second-marked');
  assert.equal(firstLive?.closeMode, 'discard-pending');
  assert.equal(secondLive?.closeMode, 'discard-pending');
  assert.ok(secondLive?.closePromise);

  let directSecondSettled = false;
  const directSecond = harness.lifecycle.close('second-marked').then(() => {
    directSecondSettled = true;
  });
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(directSecondSettled, false);
  assert.equal(
    harness.calls.some(
      (call) => call.method === 'session.close' && call.args[0] === 'second-marked',
    ),
    false,
  );

  releaseFirst();
  await Promise.all([closingAll, directSecond]);
  assert.deepEqual(
    harness.calls.filter((call) => call.method === 'session.close').map((call) => call.args[0]),
    ['first-marked', 'second-marked'],
  );
});

test('closeAll records a cleanup failure and still closes later sessions', async () => {
  const harness = createHarness();
  const first = new RejectingCloseSession('first-rejecting', {}, harness.calls);
  const second = new FakeFactorySession('second-after-rejection', {}, harness.calls);
  harness.runtime.createQueue.push(first, second);
  await harness.lifecycle.create(createCommand());
  await first.waitForPrompts(1);
  await harness.lifecycle.create(createCommand());
  await second.waitForPrompts(1);
  await new Promise<void>((resolve) => setImmediate(resolve));

  await assert.rejects(harness.lifecycle.closeAll(), /close failed: first-rejecting/);
  assert.deepEqual(
    harness.calls.filter((call) => call.method === 'session.close').map((call) => call.args[0]),
    ['first-rejecting', 'second-after-rejection'],
  );
  assert.equal(harness.registry.liveSessionsSnapshot().length, 0);
});

test('closing an active session discards queued sends without reopening it', async () => {
  const harness = createHarness();
  const provider = queueCreate(harness, 'closing');
  const gate = provider.deferNextStream();
  await harness.lifecycle.create(createCommand('active'));
  await provider.waitForPrompts(1);
  await harness.lifecycle.send('closing', 'queued');
  const live = requireLive(harness, 'closing');

  await harness.lifecycle.close('closing');
  gate.resolve();
  await new Promise<void>((resolve) => setImmediate(resolve));

  assert.deepEqual(provider.prompts, ['active']);
  assert.deepEqual(live.pendingSends, []);
  assert.equal(harness.runtime.loadCalls.length, 0);
  assert.equal(harness.registry.getLive('closing'), undefined);
});

test('concurrent close waits for cleanup and discard overrides queue preservation', async () => {
  const harness = createHarness();
  let finishProviderClose: () => void = () => undefined;
  const provider = new CallbackCloseSession(
    'concurrent-close',
    harness.calls,
    () =>
      new Promise<void>((resolve) => {
        finishProviderClose = resolve;
      }),
  );
  harness.runtime.createQueue.push(provider);
  await harness.lifecycle.create(createCommand());
  await provider.waitForPrompts(1);
  await new Promise<void>((resolve) => setImmediate(resolve));
  const live = requireLive(harness, 'concurrent-close');
  live.pendingSends = [{ text: 'preserve unless user closes', order: 0 }];

  const preserving = harness.lifecycle.close('concurrent-close', 'preserve-pending');
  await new Promise<void>((resolve) => setImmediate(resolve));
  let discardSettled = false;
  const discarding = harness.lifecycle.close('concurrent-close').then(() => {
    discardSettled = true;
  });
  await new Promise<void>((resolve) => setImmediate(resolve));

  assert.equal(discardSettled, false);
  assert.equal(live.closeMode, 'discard-pending');
  assert.deepEqual(live.pendingSends, []);
  finishProviderClose();
  await Promise.all([preserving, discarding]);
  assert.equal(harness.registry.getLive('concurrent-close'), undefined);
});

test('accepted settings stay durable through resume and precede first-send application', async () => {
  const saved = summary('app-pending', 'provider-pending', {
    modelId: 'model-saved',
    reasoningEffort: ReasoningEffort.Low,
  });
  const harness = createHarness([saved]);
  const provider = new FakeFactorySession('provider-pending', {}, harness.calls, {
    settings: { modelId: 'model-saved', reasoningEffort: ReasoningEffort.Low },
  });
  queueLoad(harness, 'provider-pending', provider);
  const pending = {
    modelId: 'model-pending',
    reasoningEffort: ReasoningEffort.High,
  };
  harness.setProjection(pending);
  await harness.lifecycle.resume('app-pending');
  assert.equal(harness.registry.getCanonicalSummary('app-pending')?.modelId, 'model-pending');
  assert.equal(harness.registry.resolveSummary('app-pending')?.modelId, 'model-pending');
  assert.equal(harness.registry.listSummaries().sessions[0]?.reasoningEffort, ReasoningEffort.High);
  assert.equal(harness.history.persisted.at(-1)?.modelId, 'model-pending');
  assert.equal(
    harness.events.find((event) => event.type === 'session.created')?.session.modelId,
    'model-pending',
  );
  const replaced = await harness.registry.replaceProvider('app-pending', 'provider-next');
  assert.equal(replaced?.modelId, 'model-pending');
  assert.equal(harness.history.persisted.at(-1)?.modelId, 'model-pending');
  harness.setPendingApply(async (appSessionId) => {
    await provider.updateSettings(pending);
    harness.registry.updateSummary(appSessionId, pending);
    return true;
  });
  await harness.lifecycle.send('app-pending', 'apply now');
  assert.deepEqual(provider.settings, [{ autonomyLevel: 'off' }, pending]);
  assert.deepEqual(provider.prompts, ['apply now']);
  const settingsCall = harness.calls.findIndex((call) => call.method === 'updateSettings');
  const streamCall = harness.calls.findIndex(
    (call) => call.method === 'stream' && call.args[1] === 'apply now',
  );
  assert.ok(settingsCall >= 0 && settingsCall < streamCall);
  assert.equal(harness.registry.getCanonicalSummary('app-pending')?.modelId, 'model-pending');
  assert.equal(harness.history.persisted.at(-1)?.reasoningEffort, ReasoningEffort.High);

  const failed = createHarness([saved]);
  const failedProvider = new FakeFactorySession('provider-pending', {}, failed.calls, {
    settings: { modelId: 'model-saved', reasoningEffort: ReasoningEffort.Low },
  });
  queueLoad(failed, 'provider-pending', failedProvider);
  failed.setProjection(pending);
  await failed.lifecycle.resume('app-pending');
  failed.setPendingApply(() => Promise.resolve(false));
  await failed.lifecycle.send('app-pending', 'must not stream');
  assert.deepEqual(failedProvider.prompts, []);
  assert.equal(failed.registry.getCanonicalSummary('app-pending')?.modelId, 'model-pending');
  assert.equal(failed.registry.resolveSummary('app-pending')?.modelId, 'model-pending');
});

test('a session tracks its provider pid and close kills its processes while the provider is their parent', async () => {
  const h = createHarness();
  h.setMcpConfigs([
    { name: 'local', command: 'npx', args: ['-y', 'some-mcp'], env: {} },
    { name: 'remote', type: 'http', url: 'https://mcp.example', headers: [] },
  ]);
  const provider = queueCreate(h, 'created-pid');
  h.runtime.processIds.set('created-pid', 4321);
  h.setChildCloser((appSessionId) => {
    h.calls.push({ target: 'cleanup', method: 'children.close', args: [appSessionId] });
    return Promise.resolve();
  });
  await h.lifecycle.create(createCommand());
  await provider.waitForPrompts(1);

  await h.lifecycle.close('created-pid');

  assert.deepEqual(
    h.calls
      .filter(
        (call) =>
          call.method.startsWith('processes.') ||
          call.method === 'children.close' ||
          call.method === 'session.close',
      )
      .map((call) => [call.method, ...call.args]),
    [
      // Configured stdio MCP servers are the session's own processes, not leaks.
      ['processes.setIgnoredCommands', 'created-pid', 'npx -y some-mcp'],
      ['processes.track', 'created-pid', 4321],
      // The kill has to precede every provider close of the session: once
      // `droid` exits, its dev servers are reparented and no longer reachable
      // from its pid. Child runtimes are tracked under the same session id, so
      // their servers go with this one call too.
      ['processes.killSession', 'created-pid'],
      ['children.close', 'created-pid'],
      ['session.close', 'created-pid'],
      ['processes.untrack', 4321],
    ],
  );

  const resumed = createHarness([summary('app-2', 'provider-2')]);
  queueLoad(resumed, 'provider-2');
  resumed.runtime.processIds.set('provider-2', 991);
  await resumed.lifecycle.resume('app-2');
  assert.deepEqual(
    resumed.calls.filter((call) => call.method === 'processes.track').map((call) => call.args),
    [['app-2', 991]],
  );
});

test('scheduled delivery resumes the exact historical provider and waits for a runtime acknowledgement', async () => {
  const harness = createHarness([summary('scheduled-app', 'scheduled-provider')]);
  const provider = queueLoad(harness, 'scheduled-provider');
  const turn = provider.deferNextStream();
  const delivery = harness.lifecycle.deliverScheduled(
    'scheduled-app',
    'scheduled prompt',
    () => true,
  );
  await provider.waitForPrompts(1);
  assert.deepEqual(provider.prompts, ['scheduled prompt']);
  assert.equal(harness.runtime.loadCalls.length, 1);
  assert.equal(requireLive(harness, 'scheduled-app').streaming, true);
  turn.resolve();
  const receipt = await delivery;
  assert.equal(receipt.status, 'accepted');
  if (receipt.status === 'accepted') await receipt.settled;
  assert.equal(requireLive(harness, 'scheduled-app').streaming, false);
  await harness.lifecycle.closeAll();
});

test('scheduled delivery waits outside pendingSends for turns, compaction, interactions and ready user sends', async () => {
  const harness = createHarness([
    summary('scheduled-busy', 'scheduled-busy', { provider: 'claude' }),
  ]);
  const provider = new FakeFactorySession('scheduled-busy', {}, harness.calls);
  harness.setProvider(claudeResumeProvider(harness, provider));
  await harness.lifecycle.resume('scheduled-busy');
  const live = requireLive(harness, 'scheduled-busy');
  const busy = async () => {
    assert.deepEqual(
      await harness.lifecycle.deliverScheduled('scheduled-busy', 'must wait', () => true),
      { status: 'busy', retryOn: 'target' },
    );
    assert.deepEqual(provider.prompts, []);
  };
  live.streaming = true;
  await busy();
  live.streaming = false;
  live.compacting = true;
  await busy();
  live.compacting = false;
  live.autoCompacting = true;
  await busy();
  live.autoCompacting = false;
  harness.setPendingInteractions(true);
  await busy();
  harness.setPendingInteractions(false);
  live.pendingSends.push({ text: 'user prompt', order: 0 });
  await busy();
  assert.deepEqual(
    live.pendingSends.map((pending) => pending.text),
    ['user prompt'],
  );
  live.pendingSends = [];
  harness.setSettingsWait(() => {
    live.streaming = true;
    return Promise.resolve();
  });
  await busy();
  assert.deepEqual(live.pendingSends, [], 'a settings race must not detach the delivery receipt');
  live.streaming = false;
  let current = true;
  harness.setSettingsWait(() => {
    current = false;
    live.streaming = true;
    return Promise.resolve();
  });
  assert.deepEqual(
    await harness.lifecycle.deliverScheduled('scheduled-busy', 'withdrawn', () => current),
    { status: 'cancelled' },
  );
  assert.deepEqual(live.pendingSends, []);
  await harness.lifecycle.closeAll();
});

test('an old typed turn cannot close the replacement runtime event source', async () => {
  const rows: TranscriptEvent[] = [];
  const flow = new SessionEventFlow({
    appendTranscript: (event) => rows.push(event),
    flushTranscript: () => undefined,
    applySideEffects: () => undefined,
    resolveChildScope: () => undefined,
    recordUsage: () => undefined,
  });
  const oldTurn = turnGate();
  const replacementTurn = turnGate();
  let waiting = oldTurn.promise;
  const h = createHarness([summary('replaced')], undefined, {
    eventFlow: flow,
    forgetEventFlow: (id) => flow.forgetSession(id),
    runPrimaryTurn: (live) => {
      flow.beginTurn(live.summary.appSessionId, live.summary.appSessionId);
      return waiting;
    },
  });
  queueLoad(h, 'replaced');
  await h.lifecycle.resume('replaced');
  const oldSend = h.lifecycle.send('replaced', 'old');
  await new Promise((resolve) => setImmediate(resolve));
  await h.lifecycle.close('replaced');
  queueLoad(h, 'replaced');
  await h.lifecycle.resume('replaced');
  waiting = replacementTurn.promise;
  const newSend = h.lifecycle.send('replaced', 'replacement');
  await new Promise((resolve) => setImmediate(resolve));
  oldTurn.resolve();
  await oldSend;
  flow.apply('replaced', 'replaced', 'primary', {
    transcript: {
      id: 'replacement-reply',
      appSessionId: 'replaced',
      sourceSessionId: 'replaced',
      role: 'primary',
      ts: 1,
      kind: 'text',
      text: 'replacement reply',
    },
  });
  assert.deepEqual(
    rows.map((row) => row.text),
    ['replacement reply'],
  );
  assert.equal(requireLive(h, 'replaced').streaming, true);
  replacementTurn.resolve();
  await newSend;
  await h.lifecycle.closeAll();
});

test('typed preparation waits for delegated flush without losing its prompt or draining concurrently', async () => {
  const stored = turnGate();
  const flushed = turnGate();
  const rows: string[] = [];
  const recordPrompt = (_id: string, prompt: string) => {
    rows.push(prompt);
    return stored.promise;
  };
  let providerRunning = false;
  let delegated: (running: boolean, end?: DelegatedTurnEnd) => void = () =>
    assert.fail('no listener');
  const h = createHarness([summary('overlap', 'overlap', { provider: 'claude' })], undefined, {
    settleStreaming: () => flushed.promise,
    runPrimaryTurn: (live, request) =>
      runPrimaryTurn(
        {
          eventFlow: { beginTurn: () => undefined, apply: () => undefined },
          context: {
            beginTurn: () => undefined,
            startPolling: () => undefined,
            stopPolling: () => undefined,
            refresh: () => Promise.resolve(),
          },
          timeline: {
            recordPrompt,
            announcePrompt: recordPrompt,
            settleStreaming: () => Promise.resolve(),
            appendStatus: () => undefined,
            appendError: () => undefined,
          },
          contextTarget: () => undefined,
          isCurrent: (current) => h.registry.getLive('overlap') === current && !current.closeMode,
          applyDesignToolPolicy: () => Promise.resolve(true),
          updateSummary: (id, patch) => {
            h.registry.updateSummary(id, patch);
          },
          emitError: () => assert.fail('unexpected turn error'),
        },
        live,
        request,
      ),
  });
  const fake = new FakeFactorySession('overlap', {}, h.calls);
  const typed = fake.deferNextStream();
  const base = claudeResumeProvider(h, fake);
  h.setProvider({
    ...base,
    resume: async (id, input) => {
      const resumed = await base.resume(id, input);
      return {
        ...resumed,
        onDelegatedTurn: (listener) => {
          delegated = listener;
          return () => undefined;
        },
        stream: async function* (prompt, mentions) {
          if (providerRunning) throw new Error('provider turn still running');
          yield* resumed.stream(prompt, mentions);
        },
      };
    },
  });
  await h.lifecycle.resume('overlap');
  const sending = h.lifecycle.send('overlap', 'typed');
  await new Promise((resolve) => setImmediate(resolve));
  providerRunning = true;
  delegated(true);
  await h.lifecycle.send('overlap', 'queued', undefined, 'queued');
  stored.resolve();
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(fake.prompts, []);
  providerRunning = false;
  delegated(false, { status: 'completed' });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(requireLive(h, 'overlap').streaming, true);
  assert.deepEqual(fake.prompts, []);
  flushed.resolve();
  await fake.waitForPrompts(1);
  assert.deepEqual(fake.prompts, ['typed']);
  assert.deepEqual(
    requireLive(h, 'overlap').pendingSends.map((prompt) => prompt.text),
    ['queued'],
  );
  await h.lifecycle.send('overlap', 'second');
  await h.lifecycle.send('overlap', 'third');
  const next = fake.deferNextStream();
  const interrupt = fake.deferNextInterrupt();
  const sendingNow = h.lifecycle.sendNow('overlap', 'queued');
  delegated(true);
  delegated(false, { status: 'interrupted' });
  typed.resolve();
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(fake.prompts, ['typed']);
  interrupt.resolve();
  await sendingNow;
  await sending;
  await fake.waitForPrompts(2);
  assert.deepEqual(fake.prompts, ['typed', 'queued']);
  next.resolve();
  await fake.waitForPrompts(4);
  await requireLive(h, 'overlap').turnPromise;
  assert.deepEqual(fake.prompts, ['typed', 'queued', 'second', 'third']);
  assert.deepEqual(rows, ['typed', 'queued', 'second', 'third']);
  assert.equal(requireLive(h, 'overlap').streaming, false);
  await h.lifecycle.closeAll();
});

test('scheduled delivery rejects unknown IDs and discards settings results after cancellation or provider replacement', async () => {
  const harness = createHarness([summary('scheduled-race')]);
  const provider = queueLoad(harness, 'scheduled-race');
  assert.equal(
    (await harness.lifecycle.deliverScheduled('deleted', 'never create', () => true)).status,
    'unavailable',
  );
  assert.equal(harness.runtime.loadCalls.length, 0);
  await harness.lifecycle.resume('scheduled-race');
  let apply: (value: boolean) => void = () => undefined;
  harness.setPendingApply(
    () =>
      new Promise<boolean>((resolve) => {
        apply = resolve;
      }),
  );
  let current = true;
  const canceled = harness.lifecycle.deliverScheduled('scheduled-race', 'canceled', () => current);
  current = false;
  apply(true);
  assert.equal((await canceled).status, 'cancelled');
  const replaced = harness.lifecycle.deliverScheduled('scheduled-race', 'stale', () => true);
  const live = requireLive(harness, 'scheduled-race');
  live.session = new DroidProviderSession(
    'scheduled-race',
    new FakeFactorySession('replacement', {}, harness.calls),
    harness.runtime,
  );
  apply(true);
  assert.equal((await replaced).status, 'unavailable');
  assert.deepEqual(provider.prompts, []);
  await harness.lifecycle.closeAll();
});

test('scheduled historical resumes honor the runtime cap without restricting live targets', async () => {
  const summaries = Array.from({ length: 9 }, (_, index) => summary(`bounded-${index}`));
  const harness = createHarness(summaries);
  for (let index = 0; index < 8; index += 1) {
    queueLoad(harness, `bounded-${index}`);
    await harness.lifecycle.resume(`bounded-${index}`);
  }
  assert.deepEqual(
    await harness.lifecycle.deliverScheduled('bounded-8', 'wait for capacity', () => true),
    { status: 'busy', retryOn: 'capacity' },
  );
  assert.equal(harness.runtime.loadCalls.length, 8);
  const live = await harness.lifecycle.deliverScheduled(
    'bounded-0',
    'already resident',
    () => true,
  );
  assert.equal(live.status, 'accepted');
  if (live.status === 'accepted') await live.settled;
  await harness.lifecycle.close('bounded-0');
  const provider = queueLoad(harness, 'bounded-8');
  const receipt = await harness.lifecycle.deliverScheduled(
    'bounded-8',
    'capacity freed',
    () => true,
  );
  assert.equal(receipt.status, 'accepted');
  if (receipt.status === 'accepted') await receipt.settled;
  assert.deepEqual(provider.prompts, ['capacity freed']);
  await harness.lifecycle.closeAll();
});

test('a resume that fails hands its scheduled runtime slot back without a session closing', async () => {
  const harness = createHarness([
    ...Array.from({ length: 7 }, (_, index) => summary(`held-${index}`)),
    summary('doomed'),
    summary('waiting'),
  ]);
  for (let index = 0; index < 7; index += 1) {
    queueLoad(harness, `held-${index}`);
    await harness.lifecycle.resume(`held-${index}`);
  }
  assert.equal(harness.capacityReleases(), 0);

  // Seven resident plus one resume in flight is the whole scheduled budget.
  harness.runtime.loadQueue.set('doomed', [new Error('provider is gone')]);
  const gate = harness.runtime.deferNextLoad();
  const doomed = harness.lifecycle.resume('doomed');
  await harness.runtime.waitForLoad('doomed');
  assert.deepEqual(
    await harness.lifecycle.deliverScheduled('waiting', 'needs a slot', () => true),
    { status: 'busy', retryOn: 'capacity' },
  );

  gate.resolve();
  assert.equal(await doomed, false);
  // No session closed, so this callback is the only thing that says a slot is
  // free again; without it a capacity-blocked delivery never retries.
  assert.equal(harness.capacityReleases(), 1);
  await harness.lifecycle.closeAll();
});

test('closing a scheduled target during cold resume invalidates its provisional runtime', async () => {
  const harness = createHarness([summary('cold-close')]);
  const provider = queueLoad(harness, 'cold-close');
  const load = harness.runtime.deferNextLoad();
  const delivery = harness.lifecycle.deliverScheduled('cold-close', 'Do not send', () => true);
  await harness.runtime.waitForLoad('cold-close');
  const closing = harness.lifecycle.close('cold-close');
  load.resolve();
  assert.equal((await delivery).status, 'unavailable');
  await closing;
  assert.equal(harness.registry.getLive('cold-close'), undefined);
  assert.deepEqual(provider.prompts, []);
  assert.ok(
    harness.calls.some((call) => call.method === 'session.close' && call.args[0] === 'cold-close'),
  );
});

test('Droid resume reapplies edits-only while keeping the stored or native autonomy', async () => {
  const indexed = createHarness([
    summary('app-permissions', 'provider-permissions', { autonomy: 'low' }),
  ]);
  const stored = queueLoad(indexed, 'provider-permissions');
  await indexed.lifecycle.resume('app-permissions');
  assert.deepEqual(stored.settings[0], { autonomyLevel: 'off' });
  assert.equal(indexed.registry.getLive('app-permissions')?.summary.autonomy, 'low');

  const unindexed = createHarness();
  const external = new FakeFactorySession('external-session', {}, unindexed.calls, {
    settings: { autonomyLevel: 'low' },
  });
  queueLoad(unindexed, 'external-session', external);
  await unindexed.lifecycle.resume('external-session');
  assert.deepEqual(external.settings[0], { autonomyLevel: 'off' });
  assert.equal(unindexed.registry.getLive('external-session')?.summary.autonomy, 'low');
});

test('agent completion cannot start a turn while Stop or Send now is outstanding', async () => {
  const h = createHarness([summary('app-1', 'provider-1')]);
  const provider = queueLoad(h, 'provider-1');
  await h.lifecycle.resume('app-1');
  const live = requireLive(h, 'app-1');
  for (const flag of ['interrupting', 'interruptingToSend'] as const) {
    live[flag] = true;
    assert.equal(
      h.lifecycle.wakeForSettledAgents('app-1', 'agent result', 'Agents finished'),
      false,
    );
    assert.deepEqual(provider.prompts, []);
    live[flag] = false;
  }
  assert.equal(h.lifecycle.wakeForSettledAgents('app-1', 'agent result', 'Agents finished'), true);
  await live.turnPromise;
  assert.deepEqual(provider.prompts, ['agent result']);
  // A wave held back by a Stop is owed once the Stop is over: the lifecycle
  // asks the child sessions to try again as soon as the flag clears.
  const retriesBefore = retryWaveCount(h);
  await h.lifecycle.interrupt('app-1');
  assert.equal(live.interrupting, false);
  assert.equal(retryWaveCount(h), retriesBefore + 1);
  await h.lifecycle.close('app-1');
});

function retryWaveCount(harness: Harness): number {
  return harness.calls.filter(
    (call) => call.target === 'cleanup' && call.method === 'children.retryWave',
  ).length;
}

test('agent wake setup failures reach the background-turn error owner', async () => {
  const h = createHarness([summary('app-1', 'provider-1')]);
  queueLoad(h, 'provider-1');
  await h.lifecycle.resume('app-1');
  h.history.nextSyncError = new Error('wake persistence failed');
  h.lifecycle.wakeForSettledAgents('app-1', 'agent result', 'Agents finished');
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(
    h.events.filter((event) => event.type === 'error').map((event) => event.message),
    ['wake persistence failed'],
  );
  await h.lifecycle.close('app-1');
});

test('a Stop takes back a prompt that has not started its turn', async () => {
  const h = createHarness([summary('app-1', 'provider-1')]);
  const provider = new FakeFactorySession('provider-1', {}, h.calls);
  queueLoad(h, 'provider-1', provider);
  await h.lifecycle.resume('app-1');
  requireLive(h, 'app-1').summary.provider = 'claude';
  let settle: () => void = () => undefined;
  h.setSettingsWait(
    () =>
      new Promise<void>((resolve) => {
        settle = resolve;
      }),
  );

  const sending = h.lifecycle.send('app-1', 'stopped while it waited');
  await new Promise((resolve) => setImmediate(resolve));
  await h.lifecycle.interrupt('app-1');
  settle();
  await sending;

  assert.deepEqual(provider.prompts, []);
  await h.lifecycle.close('app-1');
});

// A Claude provider whose resume hands back a Droid fake, optionally after the
// caller's hook (an assertion or a gate) has run.
function claudeResumeProvider(
  harness: Harness,
  session: FakeFactorySession,
  beforeResume: (id: string, input: ProviderResumeInput) => Promise<void> | void = () => undefined,
  setInteractionMode?: (mode: string) => Promise<void>,
): Provider {
  const resumed = new DroidProviderSession(session.sessionId, session, harness.runtime);
  return {
    kind: 'claude',
    create: () => Promise.reject(new Error('unexpected create')),
    fork: () => Promise.reject(new Error('unexpected fork')),
    readUsage: () => Promise.reject(new Error('unexpected usage read')),
    resume: async (id, input) => {
      await beforeResume(id, input);
      return {
        provider: 'claude',
        providerSessionId: id,
        ...(setInteractionMode ? { setInteractionMode } : {}),
        stream: resumed.stream.bind(resumed),
        steer: () => Promise.resolve(false),
        setModel: resumed.setModel.bind(resumed),
        setAutonomy: resumed.setAutonomy.bind(resumed),
        interrupt: resumed.interrupt.bind(resumed),
        close: resumed.close.bind(resumed),
      };
    },
  };
}

test('a context switch waits for the turn and resumes the same chat before queued work', async () => {
  const stored: SessionSummary[] = [];
  const h = createHarness(stored);
  const original = queueCreate(h, 'context-switch');
  const gate = original.deferNextStream();
  await h.lifecycle.create(createCommand());
  await original.waitForPrompts(1);
  const live = requireLive(h, 'context-switch');
  live.summary.provider = 'claude';
  live.summary.interactionMode = 'spec';
  live.summary.contextWindowTokens = 1000000;
  live.summary.maxContextTokens = 1000000;
  const replacement = new FakeFactorySession('context-switch', {}, h.calls);
  h.setProvider(
    claudeResumeProvider(
      h,
      replacement,
      (id, input) => {
        assert.equal(id, 'context-switch');
        assert.equal(input.contextWindowTokens, 200000);
      },
      async (mode) => {
        assert.equal(mode, 'spec');
      },
    ),
  );
  const settings = new SessionModelSettings({
    registry: h.registry,
    runtime: h.runtime,
    getFactoryDefaults: async () => ({}),
    providerDefaultModelId: () => 'model-default',
    knownModel: () => undefined,
    validateModelSettings: async (_summary, selection) => {
      if (selection.modelId === 'unavailable') throw new Error('1M context unavailable');
    },
    maxContextTokensForModel: () => undefined,
    isShutdownStarted: () => false,
    refreshPrimary: async () => undefined,
    onPrimaryModelChanged: () => Promise.resolve(),
    onSettled: () => {
      stored.splice(0, stored.length, { ...live.summary });
    },
    emitError: (error) => assert.fail(error.message),
  });
  h.setSettingsWait(() => settings.waitForMutations('context-switch'));
  const changed = settings.update('context-switch', 'primary', { contextWindowTokens: 200000 });
  await h.lifecycle.send('context-switch', 'next');
  assert.equal(live.summary.contextWindowTokens, 1000000);
  assert.equal(live.closeMode, undefined);
  gate.resolve();
  assert.equal(await changed, true);
  await replacement.waitForPrompts(1);
  assert.equal(requireLive(h, 'context-switch').summary.appSessionId, 'context-switch');
  assert.equal(requireLive(h, 'context-switch').summary.contextWindowTokens, 200000);
  assert.deepEqual(original.prompts, ['first']);
  assert.deepEqual(replacement.prompts, ['next']);
  assert.ok(h.calls.some((call) => call.method === 'close' || call.method === 'session.close'));
  await requireLive(h, 'context-switch').turnPromise;
  const beforeRejected = h.registry.getCanonicalSummary('context-switch');
  await assert.rejects(
    settings.update('context-switch', 'primary', {
      modelId: 'unavailable',
      contextWindowTokens: 1000000,
    }),
    /1M context unavailable/,
  );
  assert.deepEqual(h.registry.getCanonicalSummary('context-switch'), beforeRejected);
  assert.equal(requireLive(h, 'context-switch').restartBeforeNextTurn, undefined);

  // A Stop that lands while the chat is relaunching has no runtime to
  // interrupt, and still keeps the prompt from being sent.
  assert.equal(
    await settings.update('context-switch', 'primary', { contextWindowTokens: 1000000 }),
    true,
  );
  let finishResume: () => void = () => undefined;
  const resuming = new Promise<void>((resolve) => {
    finishResume = resolve;
  });
  const relaunched = new FakeFactorySession('context-switch', {}, h.calls);
  h.setProvider(claudeResumeProvider(h, relaunched, () => resuming));
  const sending = h.lifecycle.send('context-switch', 'stopped before it was sent');
  while (h.registry.getLive('context-switch'))
    await new Promise((resolve) => setImmediate(resolve));
  await h.lifecycle.interrupt('context-switch');
  // Sent after the Stop, while the chat still has no runtime: these wait for
  // it in the order they were sent.
  const later = [
    h.lifecycle.send('context-switch', 'second'),
    h.lifecycle.send('context-switch', 'third'),
  ];
  finishResume();
  await Promise.all([sending, ...later]);
  await relaunched.waitForPrompts(2);
  assert.deepEqual(relaunched.prompts, ['second', 'third']);
  await requireLive(h, 'context-switch').turnPromise;

  // A send still being prepared when the relaunch begins joins its queue.
  const window = requireLive(h, 'context-switch').summary.contextWindowTokens;
  assert.equal(
    await settings.update('context-switch', 'primary', {
      contextWindowTokens: window === 200000 ? 1000000 : 200000,
    }),
    true,
  );
  assert.equal(requireLive(h, 'context-switch').restartBeforeNextTurn, true);
  let finishSecondResume: () => void = () => undefined;
  const resumingAgain = new Promise<void>((resolve) => {
    finishSecondResume = resolve;
  });
  const again = new FakeFactorySession('context-switch', {}, h.calls);
  h.setProvider(claudeResumeProvider(h, again, () => resumingAgain));
  let prepareSecond: () => void = () => undefined;
  let applies = 0;
  h.setPendingApply(async () => {
    applies += 1;
    if (applies === 2)
      await new Promise<void>((resolve) => {
        prepareSecond = resolve;
      });
    return true;
  });
  const first = h.lifecycle.send('context-switch', 'A');
  const second = h.lifecycle.send('context-switch', 'B');
  // B finishes preparing while A's relaunch has the chat without a runtime.
  while (h.registry.getLive('context-switch'))
    await new Promise((resolve) => setImmediate(resolve));
  prepareSecond();
  await new Promise((resolve) => setImmediate(resolve));
  finishSecondResume();
  await Promise.all([first, second]);
  // Bounded, so a dropped B fails the assertion instead of hanging the suite.
  for (let tick = 0; tick < 500 && again.prompts.length < 2; tick += 1)
    await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(again.prompts, ['A', 'B']);
  await h.lifecycle.close('context-switch');
});

test('dependent ownership is committed before the first provider turn, and a failed commit runs nothing', async () => {
  let release = () => {};
  let entered = () => {};
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const binding = new Promise<void>((resolve) => {
    entered = resolve;
  });
  const h = createHarness([], async (session, clientRef) => {
    assert.equal(session.appSessionId, 'bound');
    assert.equal(clientRef, 'client-1');
    entered();
    await gate;
  });
  const provider = queueCreate(h, 'bound');
  const creating = h.lifecycle.create(createCommand());
  await binding;
  assert.equal(
    h.calls.some((call) => call.method === 'stream'),
    false,
  );
  release();
  await creating;
  await provider.waitForPrompts(1);
  await h.lifecycle.closeAll();

  const failed = createHarness([], async () => {
    throw new Error('Project ledger is full');
  });
  queueCreate(failed, 'failed-bind');
  await failed.lifecycle.create(createCommand());
  assert.equal(
    failed.calls.some((call) => call.method === 'stream'),
    false,
  );
  assert.equal(failed.registry.getLive('failed-bind'), undefined);
  assert.ok(
    failed.events.some(
      (event) => event.type === 'error' && event.message.includes('Project ledger is full'),
    ),
  );
});
