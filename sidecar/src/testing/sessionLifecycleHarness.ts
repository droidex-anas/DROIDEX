import assert from 'node:assert/strict';
import { ReasoningEffort, type McpServerConfig } from '@factory/droid-sdk';
import { CanvasScopes } from '../canvas/canvasScopes.js';
import { CanvasTurns } from '../canvas/canvasTurnContext.js';
import type { HistoricalSession } from '../history.js';
import type {
  FactoryDefaultSettings,
  PermissionOutcome,
  ServerEvent,
  SessionSummary,
} from '../protocol.js';
import type { ProviderQuestionAnswers } from '../providers/interactions.js';
import type { Provider } from '../providers/session.js';
import { DroidProvider } from '../providers/droid/DroidProvider.js';
import { DroidProviderSession } from '../providers/droid/DroidProviderSession.js';
import {
  SessionLifecycle,
  type LiveSession,
  type SessionCreateCommand,
  type SessionLifecycleDependencies,
} from '../SessionLifecycle.js';
import { SessionRegistry } from '../SessionRegistry.js';
import { FakeFactoryRuntime, FakeFactorySession, type RecordedCall } from './fakeFactoryRuntime.js';

export class TestHistory {
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

export function createHarness(
  ordinarySummaries: SessionSummary[] = [],
  beforeFirstTurn?: SessionLifecycleDependencies['beforeFirstTurn'],
  overrides: Partial<SessionLifecycleDependencies> = {},
  attachedCanvasId: (appSessionId: string) => string | null = () => null,
) {
  const calls: RecordedCall[] = [];
  const events: ServerEvent[] = [];
  const publicationRegistration: boolean[] = [];
  const runtimeLoads: number[] = [];
  const forgettingAfterUnregister: boolean[] = [];
  const eventFlowForgettingAfterUnregister: boolean[] = [];
  const missionForgettingAfterUnregister: boolean[] = [];
  const history = new TestHistory(calls);
  const runtime = new FakeFactoryRuntime(calls);
  let provider: Provider = new DroidProvider(runtime, () => undefined);
  let projection: Partial<SessionSummary> = {};
  let waitForSettings = (): Promise<void> => Promise.resolve();
  let waitForHistory = (): Promise<void> => Promise.resolve();
  let applyPending: (appSessionId: string) => Promise<boolean> = () => Promise.resolve(true);
  let enableAutoCompaction = (): Promise<boolean> => Promise.resolve(true);
  let compactionLimit = (): Promise<number> => Promise.resolve(800);
  let shutdownStarted = false;
  let pendingInteractions = false;
  let capacityReleases = 0;
  let closeChildren: (appSessionId: string) => Promise<void> = () => Promise.resolve();
  let killProcesses: (appSessionId: string) => Promise<void> = () => Promise.resolve();
  let emitSessionList: (closedProviderSessionId: string) => void | Promise<void> = () => {
    recordEvent({ type: 'sessions.list', ...registry.listSummaries() });
  };
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
    onSummaryUpdated: (session) => {
      recordEvent({ type: 'session.updated', session });
    },
    onLiveSetChanged: () => runtimeLoads.push(lifecycle.runtimeLoad().live),
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
  // Most lifecycle cases have no attached Canvas workspace.
  const canvasScopes = new CanvasScopes();
  const canvasTurns = new CanvasTurns(canvasScopes, attachedCanvasId);
  const lifecycle = new SessionLifecycle({
    whenSessionHistoryReady: () => waitForHistory(),
    beforeFirstTurn,
    eventFlow: { apply: () => undefined, beginTurn: () => undefined },
    settleStreaming: () => {
      calls.push({ target: 'cleanup', method: 'timeline.settleStreaming', args: [] });
      return Promise.resolve();
    },
    releaseRuntimeForCapacity: () => Promise.resolve(false),
    provider: () => provider,
    canvasTurns,
    registry,
    ensureConnected: () => {
      record('runtime', 'ensureConnected');
    },
    getFactoryDefaults: () => Promise.resolve(defaults),
    maxContextTokensForModel: () => 1_000,
    childSessions: {
      retryAgentWave: (appSessionId) => {
        record('cleanup', 'children.retryWave', appSessionId);
      },
      attachParent: (appSessionId) => {
        record('cleanup', 'children.attach', appSessionId);
      },
      closeParent: (appSessionId) => closeChildren(appSessionId),
    },
    startLocalMcpServers: () => {
      const resourceId = ++mcpId;
      record('runtime', 'mcp.start', resourceId);
      const close = () => {
        record('cleanup', 'mcp.close', `mcp-${String(resourceId)}`);
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
      afterTurn: (target) => {
        record('cleanup', 'autoCompaction.settled', target.appSessionId);
      },
      cancel: (target) => {
        if (target.kind === 'primary') target.liveSession.autoCompacting = false;
        else target.setAutoCompacting(false);
        const id = target.kind === 'primary' ? target.appSessionId : target.childSessionId;
        record('cleanup', 'watchdog.clear', id);
      },
      forgetSession: (appSessionId) => {
        record('cleanup', 'compaction.forgetSession', appSessionId);
      },
    },
    isShutdownStarted: () => shutdownStarted,
    agentProcesses: {
      setIgnoredCommands: (appSessionId, patterns) => {
        record('runtime', 'processes.setIgnoredCommands', appSessionId, ...patterns);
      },
      track: (appSessionId, pid) => {
        record('runtime', 'processes.track', appSessionId, pid);
      },
      untrack: (pid) => {
        record('cleanup', 'processes.untrack', pid);
      },
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
      stopPolling: (sourceSessionId) => {
        record('cleanup', 'poll.stop', sourceSessionId);
      },
      stopSession: (live) => {
        record('cleanup', 'poll.stop', live.summary.appSessionId);
        if (live.summary.providerSessionId)
          record('cleanup', 'poll.stop', live.summary.providerSessionId);
      },
      forgetSession: (live) => {
        record('cleanup', 'runtimeCaches.clear', live.summary.appSessionId);
      },
    },
    openProviderTranscript: () => undefined,
    forgetProviderTranscript: () => undefined,
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
    forgetPendingSettings: (appSessionId) => {
      record('cleanup', 'pendingSettings.forget', appSessionId);
    },
    closeBrowserSession: (appSessionId) => {
      record('browser', 'browser.close', appSessionId);
      return Promise.resolve();
    },
    stopVoiceSession: (appSessionId) => {
      record('cleanup', 'voice.stop', appSessionId);
      return Promise.resolve();
    },
    emit: recordEvent,
    emitError: (error) => {
      recordEvent({ type: 'error', ...error });
    },
    appendProgress: (appSessionId, text) => {
      record('protocol', 'progress', appSessionId, text);
    },
    appendError: (appSessionId, message) => {
      record('protocol', 'error', appSessionId, message);
    },
    appendSteer: (appSessionId, text, steerId) => {
      record('protocol', 'appendSteer', appSessionId, text, steerId);
    },
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
    canvasTurns,
    canvasScopes,
    publicationRegistration,
    runtimeLoads,
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
    setHistoryWait: (wait: () => Promise<void>) => {
      waitForHistory = wait;
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

export type Harness = ReturnType<typeof createHarness>;

export function summary(
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

export function createCommand(goal = 'first'): SessionCreateCommand {
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

export function queueCreate(harness: Harness, sessionId: string): FakeFactorySession {
  const session = new FakeFactorySession(sessionId, {}, harness.calls);
  harness.runtime.createQueue.push(session);
  return session;
}

export function queueLoad(
  harness: Harness,
  providerSessionId: string,
  session: FakeFactorySession = new FakeFactorySession(providerSessionId, {}, harness.calls),
): FakeFactorySession {
  harness.runtime.loadQueue.set(providerSessionId, [session]);
  return session;
}

export function requireLive(harness: Harness, id: string): LiveSession {
  const live = harness.registry.getLive(id);
  assert.ok(live);
  return live;
}

/** The lease the chat's running turn holds, which these cases always expect. */
export function turnLease(harness: Harness, appSessionId: string) {
  const scope = harness.canvasTurns.activeScope(appSessionId);
  assert.ok(scope?.origin === 'turn');
  return scope;
}

/** A provider that starts turns of its own beside a typed one, as Codex does. */
export function delegatingProvider(
  harness: Harness,
  session: FakeFactorySession,
  onDelegated: (notify: (running: boolean) => void) => void,
): Provider {
  const created = new DroidProviderSession(session.sessionId, session, harness.runtime);
  return {
    kind: 'codex',
    fork: () => Promise.reject(new Error('unexpected fork')),
    resume: () => Promise.reject(new Error('unexpected resume')),
    readUsage: () => Promise.reject(new Error('unexpected usage read')),
    create: () =>
      Promise.resolve({
        provider: 'codex',
        providerSessionId: session.sessionId,
        autonomy: created.autonomy,
        onDelegatedTurn: (notify: (running: boolean) => void) => {
          onDelegated(notify);
          return () => undefined;
        },
        steer: created.steer.bind(created),
        stream: created.stream.bind(created),
        setModel: created.setModel.bind(created),
        setAutonomy: created.setAutonomy.bind(created),
        interrupt: created.interrupt.bind(created),
        close: created.close.bind(created),
      }),
  };
}
