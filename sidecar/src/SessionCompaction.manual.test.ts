import assert from 'node:assert/strict';
import test from 'node:test';
import { CanvasScopes } from './canvas/canvasScopes.js';
import { CanvasTurns } from './canvas/canvasTurnContext.js';
import { DESIGN_SESSION_GUIDANCE } from './canvas/designSessionGuidance.js';
import type { PermissionOutcome, ServerEvent, SessionSummary } from './protocol.js';
import type { ProviderQuestionAnswers } from './providers/interactions.js';
import { SessionCompaction } from './SessionCompaction.js';
import type { LiveSession } from './SessionLifecycle.js';
import type { SessionSummaryPatch } from './SessionRegistry.js';
import { createCompactionTestLiveSession } from './testing/compactionTestSupport.js';
import {
  FakeFactoryRuntime,
  FakeFactorySession,
  type RecordedCall,
} from './testing/fakeFactoryRuntime.js';

type CompactionError = Omit<Extract<ServerEvent, { type: 'error' }>, 'type'>;

class NoopCompactionSession extends FakeFactorySession {
  override async compactSession(
    options: Parameters<FakeFactorySession['compactSession']>[0] = {},
  ): ReturnType<FakeFactorySession['compactSession']> {
    await super.compactSession(options);
    // Factory can return no result for a noop even though the current SDK type omits it.
    const runtimeNoop: object = {};
    return Reflect.get(runtimeNoop, 'outcome');
  }
}

class TestRegistry {
  readonly live = new Map<string, LiveSession>();
  readonly historical = new Map<string, SessionSummary>();
  nextReplaceError?: Error;

  getLive(id: string): LiveSession | undefined {
    return (
      this.live.get(id) ??
      [...this.live.values()].find(
        (session) =>
          session.summary.providerSessionId === id ||
          session.summary.compactedFromProviderSessionIds?.includes(id),
      )
    );
  }

  getCanonicalSummary(id: string): SessionSummary | undefined {
    const live = this.getLive(id);
    if (live) return live.summary;
    return (
      this.historical.get(id) ??
      [...this.historical.values()].find(
        (summary) =>
          summary.providerSessionId === id || summary.compactedFromProviderSessionIds?.includes(id),
      )
    );
  }

  hasPersistedSession(id: string): boolean {
    return this.historical.has(id);
  }

  updateSummary(id: string, patch: SessionSummaryPatch): SessionSummary | undefined {
    const live = this.getLive(id);
    if (!live) return undefined;
    live.summary = { ...live.summary, ...patch };
    return live.summary;
  }

  async replaceProvider(
    id: string,
    providerSessionId: string,
    patch: SessionSummaryPatch = {},
  ): Promise<SessionSummary | undefined> {
    const error = this.nextReplaceError;
    delete this.nextReplaceError;
    if (error) throw error;
    const summary = this.getCanonicalSummary(id);
    if (!summary) return undefined;
    const previousProviderSessionId = summary.providerSessionId ?? summary.appSessionId;
    const updated: SessionSummary = {
      ...summary,
      ...patch,
      providerSessionId,
      compactedFromProviderSessionIds: [
        ...(summary.compactedFromProviderSessionIds ?? []),
        previousProviderSessionId,
      ],
    };
    const live = this.getLive(id);
    if (live) live.summary = updated;
    else this.historical.set(updated.appSessionId, updated);
    return updated;
  }
}

function createHarness(options: { adoptSucceeds?: boolean; adopt?: () => Promise<boolean> } = {}) {
  const calls: RecordedCall[] = [];
  const untracked: number[] = [];
  const tracked = new Map<number, string>();
  const errors: CompactionError[] = [];
  const preserved: { appSessionId: string; tokensIn: number; tokensOut: number }[] = [];
  const refreshed: string[] = [];
  const statuses: string[] = [];
  const registry = new TestRegistry();
  const runtime = new FakeFactoryRuntime(calls);
  let shutdownStarted = false;
  const compaction = new SessionCompaction({
    registry,
    context: {
      recordCompaction: (target) => {
        // Mirror SessionContext.recordCompaction for primary targets: reset
        // context telemetry and bump the compaction counter so the sink's
        // in-place path produces the same summary the real context would.
        const live = registry.getLive(target.appSessionId);
        if (target.isCurrent() && live && live.droid === target.session) {
          live.summary = {
            ...live.summary,
            contextTokens: 0,
            contextAccuracy: undefined,
            autoCompactions: (live.summary.autoCompactions ?? 0) + 1,
          };
        }
      },
      refresh: (target) => {
        if (target.isCurrent()) refreshed.push(target.sourceSessionId);
        return Promise.resolve();
      },
      preserveUsage: (appSessionId, usage) => {
        preserved.push({ appSessionId, ...usage });
      },
    },
    timeline: {
      appendCompaction: () => undefined,
      appendStatus: (_appSessionId, text) => {
        statuses.push(text);
      },
    },
    runtime,
    canvasTurns: new CanvasTurns(new CanvasScopes(), () => null),
    agentProcesses: {
      track: (_appSessionId, pid, _isAlive, kind = 'provider') => {
        tracked.set(pid, kind);
      },
      untrack: (pid) => {
        untracked.push(pid);
        tracked.delete(pid);
      },
      adoptDescendantsAsRoots: () =>
        options.adopt?.() ?? Promise.resolve(options.adoptSucceeds ?? true),
    },
    interactionsFor: () => ({
      requestApproval: () => new Promise<PermissionOutcome>(() => undefined),
      requestQuestion: () => new Promise<ProviderQuestionAnswers>(() => undefined),
      cancelPending: () => undefined,
      isActive: () => true,
    }),
    emitError: (error) => {
      errors.push(error);
    },
    isShutdownStarted: () => shutdownStarted,
    getFactoryDefaults: () => Promise.resolve({}),
    maxContextTokensForModel: () => 1_000,
    resolveAutomaticTarget: () => undefined,
    settleAutomatic: () => undefined,
    onPrimaryNotification: () => undefined,
  });
  return {
    calls,
    untracked,
    tracked,
    compaction,
    errors,
    preserved,
    refreshed,
    registry,
    runtime,
    setShutdownStarted: () => {
      shutdownStarted = true;
    },
    statuses,
  };
}

function addLive(
  harness: ReturnType<typeof createHarness>,
  appSessionId = 'app-1',
  providerSessionId = 'provider-1',
  session: FakeFactorySession = new FakeFactorySession(providerSessionId, {}, harness.calls),
) {
  const live = createCompactionTestLiveSession(appSessionId, session, harness.runtime);
  live.summary.tokensIn = 12;
  live.summary.tokensOut = 4;
  live.summary.contextTokens = 80;
  live.summary.autoCompactions = 2;
  harness.registry.live.set(appSessionId, live);
  return { live, session };
}

function closeCount(calls: RecordedCall[], providerSessionId: string): number {
  return calls.filter(
    (call) =>
      call.target === 'cleanup' &&
      call.method === 'session.close' &&
      call.args[0] === providerSessionId,
  ).length;
}

test('manual noop compaction reports nothing to compact and remains ready to settle', async () => {
  const h = createHarness();
  const session = new NoopCompactionSession('provider-noop', {}, h.calls);
  const { live } = addLive(h, 'app-noop', session.sessionId, session);

  assert.deepEqual(await h.compaction.compact('app-noop'), { kind: 'ready-to-settle' });
  assert.equal(live.compacting, false);
  assert.deepEqual(h.statuses, ['Compacting conversation...', 'Nothing to compact.']);
  assert.deepEqual(h.refreshed, []);
  assert.deepEqual([live.summary.contextTokens, live.summary.autoCompactions], [80, 2]);
  assert.deepEqual(h.errors, []);
});

test('provider adoption retries cleanly after a partial first adoption', async () => {
  const h = createHarness();
  const { live, session: original } = addLive(h);
  const firstReplacement = new FakeFactorySession('provider-2', {}, h.calls);
  const secondReplacement = new FakeFactorySession('provider-2', {}, h.calls);
  original.nextCompactResult = { newSessionId: 'provider-2', removedCount: 1 };
  h.runtime.loadQueue.set('provider-2', [firstReplacement, secondReplacement]);
  h.registry.nextReplaceError = new Error('first persistence failed');

  const result = await h.compaction.compact('app-1');

  assert.deepEqual(result, { kind: 'ready-to-settle' });
  assert.equal(live.droid, secondReplacement);
  assert.equal(live.summary.providerSessionId, 'provider-2');
  assert.deepEqual([closeCount(h.calls, 'provider-1'), closeCount(h.calls, 'provider-2')], [1, 1]);
  assert.deepEqual(h.preserved, [
    { appSessionId: 'app-1', tokensIn: 12, tokensOut: 4 },
    { appSessionId: 'app-1', tokensIn: 12, tokensOut: 4 },
  ]);
  assert.equal(
    h.errors.some((error) => error.message.includes('first persistence failed')),
    true,
  );
});

test('Design compaction keeps native guidance on live replacement and historical loading', async () => {
  const liveHarness = createHarness();
  const { live, session } = addLive(liveHarness);
  live.summary.sessionPurpose = 'design';
  session.nextCompactResult = { newSessionId: 'design-compacted', removedCount: 1 };
  await liveHarness.compaction.compact(live.summary.appSessionId);
  assert.equal(
    liveHarness.runtime.loadCalls.at(-1)?.handlers.systemPromptAppend,
    DESIGN_SESSION_GUIDANCE,
  );
  assert.equal(live.summary.sessionPurpose, 'design');

  const historicalHarness = createHarness();
  addHistorical(
    historicalHarness,
    new FakeFactorySession('provider-history', {}, historicalHarness.calls),
  );
  const historical = historicalHarness.registry.getCanonicalSummary('app-history');
  assert.ok(historical);
  historical.sessionPurpose = 'design';
  await historicalHarness.compaction.compact(historical.appSessionId);
  assert.equal(
    historicalHarness.runtime.loadCalls.at(-1)?.handlers.systemPromptAppend,
    DESIGN_SESSION_GUIDANCE,
  );
});

test('a failed provider close retains ownership until a successful retry', async () => {
  const h = createHarness();
  const { live, session: original } = addLive(h);
  h.runtime.processIds.set('provider-1', 600);
  original.nextCompactResult = { newSessionId: 'provider-2', removedCount: 1 };
  original.nextCloseError = new Error('provider close failed');
  const failedReplacement = new FakeFactorySession('provider-2', {}, h.calls);
  const replacement = new FakeFactorySession('provider-2', {}, h.calls);
  h.runtime.loadQueue.set('provider-2', [failedReplacement, replacement]);

  await h.compaction.compact('app-1');

  assert.equal(live.droid, replacement);
  assert.equal(closeCount(h.calls, 'provider-1'), 2);
  assert.equal(closeCount(h.calls, 'provider-2'), 1);
  assert.deepEqual(h.untracked, [600]);
  assert.ok(h.errors.some((error) => error.message.includes('provider close failed')));
});

test('failed descendant adoption keeps the old provider alive for lifecycle cleanup', async () => {
  // Provisional replacements that close cleanly are released.
  const released = createHarness({ adoptSucceeds: false });
  const { live: releasedLive, session: releasedOriginal } = addLive(released);
  released.runtime.processIds.set('provider-1', 600);
  releasedOriginal.nextCompactResult = { newSessionId: 'provider-2', removedCount: 1 };
  released.runtime.loadQueue.set('provider-2', [
    new FakeFactorySession('provider-2', {}, released.calls),
    new FakeFactorySession('provider-2', {}, released.calls),
  ]);
  assert.equal((await released.compaction.compact('app-1')).kind, 'close-and-resume');
  assert.equal(releasedLive.droid, releasedOriginal);
  assert.deepEqual(released.untracked, []);
  assert.equal(closeCount(released.calls, 'provider-1'), 0);
  assert.equal(closeCount(released.calls, 'provider-2'), 2);

  // Provisional replacements that fail to close keep their pids owned, and the
  // adoption error is what the caller reports.
  const h = createHarness({ adoptSucceeds: false });
  const { live, session: original } = addLive(h);
  original.nextCompactResult = { newSessionId: 'provider-2', removedCount: 1 };
  const first = new FakeFactorySession('provider-2', {}, h.calls);
  const second = new FakeFactorySession('provider-2', {}, h.calls);
  first.nextCloseError = new Error('replacement close failed');
  second.nextCloseError = new Error('replacement close failed');
  const pids = new Map([
    [original, 600],
    [first, 610],
    [second, 620],
  ]);
  h.runtime.processIdOf = (session) => {
    for (const [provider, pid] of pids) if (session === provider) return pid;
    return undefined;
  };
  h.runtime.loadQueue.set('provider-2', [first, second]);
  const result = await h.compaction.compact('app-1');
  assert.equal(result.kind, 'close-and-resume');
  if (result.kind === 'close-and-resume')
    assert.match(result.reloadError, /Could not preserve processes/);
  assert.equal(live.droid, original);
  assert.deepEqual(
    [...h.tracked],
    [
      [610, 'provisional'],
      [620, 'provisional'],
    ],
  );
  assert.deepEqual(h.untracked, []);
  assert.equal(closeCount(h.calls, 'provider-1'), 0);
});

test('provider load completing after close cannot replace a reopened session', async () => {
  const h = createHarness();
  const { live, session: original } = addLive(h);
  original.nextCompactResult = { newSessionId: 'provider-2', removedCount: 1 };
  const pending = new FakeFactorySession('provider-2', {}, h.calls);
  h.runtime.loadQueue.set('provider-2', [pending]);
  const gate = h.runtime.deferNextLoad();
  const compacting = h.compaction.compact('app-1');
  await h.runtime.waitForLoad('provider-2');
  live.closeMode = 'discard-pending';
  const { live: reopened } = addLive(h, 'app-1', 'reopened');
  gate.resolve();
  await compacting;

  assert.equal(h.registry.getLive('app-1'), reopened);
  assert.equal(reopened.summary.providerSessionId, 'reopened');
  assert.equal(live.droid, original);
  assert.equal(closeCount(h.calls, 'provider-2'), 1);
  assert.deepEqual(h.preserved, []);
});

test('provider adoption completing after close leaves cleanup to lifecycle', async () => {
  let finishAdoption: (adopted: boolean) => void = () => {};
  let adoptionStarted: () => void = () => {};
  const started = new Promise<void>((resolve) => {
    adoptionStarted = resolve;
  });
  const h = createHarness({
    adopt: () => {
      adoptionStarted();
      return new Promise((resolve) => {
        finishAdoption = resolve;
      });
    },
  });
  const { live, session: original } = addLive(h);
  h.runtime.processIds.set('provider-1', 600);
  original.nextCompactResult = { newSessionId: 'provider-2', removedCount: 1 };
  h.runtime.loadQueue.set('provider-2', [new FakeFactorySession('provider-2', {}, h.calls)]);
  const compacting = h.compaction.compact('app-1');
  await started;
  live.closeMode = 'discard-pending';
  finishAdoption(false);
  await compacting;

  assert.equal(live.droid, original);
  assert.equal(closeCount(h.calls, 'provider-1'), 0);
  assert.equal(closeCount(h.calls, 'provider-2'), 1);
  assert.deepEqual(h.untracked, []);
  assert.deepEqual(h.preserved, []);
});

test('provider adoption continuations become inert after shutdown starts', async () => {
  const h = createHarness();
  const { session: original } = addLive(h);
  const replacement = new FakeFactorySession('provider-shutdown', {}, h.calls);
  const compactGate = original.deferNextCompaction();
  original.nextCompactResult = { newSessionId: replacement.sessionId, removedCount: 1 };
  h.runtime.loadQueue.set(replacement.sessionId, [replacement]);

  const compacting = h.compaction.compact('app-1');
  h.setShutdownStarted();
  compactGate.resolve();
  const result = await compacting;
  const statusesAfterCompaction = h.statuses.length;
  replacement.emitNotification({
    jsonrpc: '2.0',
    method: 'droid.session_notification',
    params: {
      notification: {
        type: 'droid_working_state_changed',
        newState: 'compacting_conversation',
      },
    },
  });

  assert.deepEqual(result, { kind: 'ready-to-settle' });
  assert.deepEqual(replacement.settings, []);
  assert.deepEqual(h.refreshed, []);
  assert.equal(h.statuses.length, statusesAfterCompaction);
});

test('permanent adoption failure persists the daemon identity before recovery, and rejects if it cannot', async () => {
  const h = createHarness();
  const { live, session } = addLive(h);
  session.nextCompactResult = { newSessionId: 'provider-7', removedCount: 1 };
  h.runtime.loadQueue.set('provider-7', [
    new Error('first adoption failed'),
    new Error('second adoption failed'),
  ]);

  assert.deepEqual(await h.compaction.compact('app-1'), {
    kind: 'close-and-resume',
    appSessionId: 'app-1',
    providerSessionId: 'provider-7',
    carryover: { tokensIn: 12, tokensOut: 4 },
    reloadError: 'second adoption failed',
  });
  assert.equal(live.summary.providerSessionId, 'provider-7');
  assert.equal(live.compacting, false);
  assert.equal(closeCount(h.calls, 'provider-1'), 0);

  const unsaved = createHarness();
  const target = addLive(unsaved);
  target.session.nextCompactResult = { newSessionId: 'provider-8', removedCount: 1 };
  unsaved.runtime.loadQueue.set('provider-8', [new Error('load one'), new Error('load two')]);
  unsaved.registry.nextReplaceError = new Error('history unavailable');

  await assert.rejects(unsaved.compaction.compact('app-1'), /history unavailable/);
  assert.equal(target.live.summary.providerSessionId, 'provider-1');
  assert.equal(target.live.compacting, false);
  assert.equal(
    unsaved.errors.some(
      (error) =>
        error.providerSessionId === 'provider-8' &&
        error.recoverable === true &&
        error.message === 'Could not persist compacted session identity: history unavailable',
    ),
    true,
  );
});

function addHistorical(h: ReturnType<typeof createHarness>, temporary: FakeFactorySession) {
  const historical = createCompactionTestLiveSession(
    'app-history',
    new FakeFactorySession('provider-history', {}, h.calls),
    h.runtime,
  ).summary;
  h.registry.historical.set(historical.appSessionId, historical);
  h.runtime.loadQueue.set('provider-history', [temporary]);
}

for (const invalidation of ['close', 'replacement'] as const) {
  test(`historical provider loading cannot compact after ${invalidation}`, async () => {
    const h = createHarness();
    const temporary = new FakeFactorySession('provider-history', {}, h.calls);
    addHistorical(h, temporary);
    const historical = h.registry.getCanonicalSummary('app-history');
    assert.ok(historical);
    const gate = h.runtime.deferNextLoad();
    let admitted = true;
    const compacting = h.compaction.compact('app-history', undefined, () => admitted);
    await h.runtime.waitForLoad('provider-history');
    if (invalidation === 'close') admitted = false;
    else historical.providerSessionId = 'provider-replacement';
    gate.resolve();
    await compacting;

    assert.equal(
      h.calls.some((call) => call.target === 'provider' && call.method === 'compactSession'),
      false,
    );
    assert.equal(closeCount(h.calls, 'provider-history'), 1);
    assert.equal(
      h.registry.getCanonicalSummary('app-history')?.providerSessionId,
      invalidation === 'close' ? 'provider-history' : 'provider-replacement',
    );
    assert.deepEqual(h.errors, []);
  });
}

test('historical compaction uses a temporary provider without live side effects, and a failed identity write is fatal', async () => {
  const h = createHarness();
  const temporary = new FakeFactorySession('provider-history', {}, h.calls);
  temporary.nextCompactResult = { newSessionId: 'provider-history-2', removedCount: 1 };
  addHistorical(h, temporary);

  assert.deepEqual(await h.compaction.compact('provider-history', 'keep decisions'), {
    kind: 'ready-to-settle',
  });
  assert.equal(
    h.registry.getCanonicalSummary('app-history')?.providerSessionId,
    'provider-history-2',
  );
  assert.equal(closeCount(h.calls, 'provider-history'), 1);
  assert.deepEqual([h.statuses, h.refreshed, h.preserved], [[], [], []]);
  assert.deepEqual(temporary.settings, []);

  const unsaved = createHarness();
  unsaved.registry.nextReplaceError = new Error('history unavailable');
  const unsavedTemporary = new FakeFactorySession('provider-history', {}, unsaved.calls);
  unsavedTemporary.nextCompactResult = { newSessionId: 'provider-history-2', removedCount: 1 };
  addHistorical(unsaved, unsavedTemporary);

  assert.deepEqual(await unsaved.compaction.compact('app-history'), { kind: 'ready-to-settle' });
  assert.equal(
    unsaved.errors.some(
      (error) =>
        error.appSessionId === 'app-history' &&
        error.providerSessionId === 'provider-history-2' &&
        error.recoverable === undefined &&
        error.message === 'Could not persist compacted session identity: history unavailable',
    ),
    true,
  );
  assert.equal(
    unsaved.registry.getCanonicalSummary('app-history')?.providerSessionId,
    'provider-history',
  );
  assert.equal(closeCount(unsaved.calls, 'provider-history'), 1);
});

test('historical noop is quiet and failure is recoverable; both keep the identity and close the temporary provider', async () => {
  const noop = createHarness();
  addHistorical(noop, new NoopCompactionSession('provider-history', {}, noop.calls));
  assert.deepEqual(await noop.compaction.compact('app-history'), { kind: 'ready-to-settle' });
  assert.deepEqual(noop.errors, []);

  const failed = createHarness();
  const temporary = new FakeFactorySession('provider-history', {}, failed.calls);
  temporary.nextCompactError = new Error('temporary provider rejected');
  addHistorical(failed, temporary);
  assert.deepEqual(await failed.compaction.compact('app-history'), { kind: 'ready-to-settle' });
  assert.equal(
    failed.errors.some(
      (error) =>
        error.appSessionId === 'app-history' &&
        error.providerSessionId === 'provider-history' &&
        error.recoverable === true &&
        error.message === 'Could not compact session: temporary provider rejected',
    ),
    true,
  );

  for (const h of [noop, failed]) {
    assert.equal(
      h.registry.getCanonicalSummary('app-history')?.providerSessionId,
      'provider-history',
    );
    assert.equal(closeCount(h.calls, 'provider-history'), 1);
  }
});
