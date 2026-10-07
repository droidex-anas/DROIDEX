import assert from 'node:assert/strict';
import test from 'node:test';
import { CanvasScopes } from './canvas/canvasScopes.js';
import { CanvasTurns } from './canvas/canvasTurnContext.js';
import type { FactoryDefaultSettings, PermissionOutcome, SessionSummary } from './protocol.js';
import type { ProviderQuestionAnswers } from './providers/interactions.js';
import {
  SessionCompaction,
  type ChildCompactionTarget,
  type PrimaryCompactionTarget,
  type SessionCompactionDependencies,
} from './SessionCompaction.js';
import { createCompactionTestLiveSession } from './testing/compactionTestSupport.js';
import {
  FakeFactoryRuntime,
  FakeFactorySession,
  type RecordedCall,
  type StreamGate,
} from './testing/fakeFactoryRuntime.js';

interface Harness {
  calls: RecordedCall[];
  compaction: SessionCompaction;
  patches: { appSessionId: string; patch: Partial<SessionSummary> }[];
  runtime: FakeFactoryRuntime;
  setDefaultsReader(reader: () => Promise<FactoryDefaultSettings>): void;
}

function createHarness(): Harness {
  const calls: RecordedCall[] = [];
  const patches: Harness['patches'] = [];
  const runtime = new FakeFactoryRuntime(calls);
  let readDefaults = (): Promise<FactoryDefaultSettings> =>
    Promise.resolve({
      modelId: 'default-model',
      compactionTokenLimit: 900,
      compactionTokenLimitPerModel: { 'default-model': 700 },
    });
  const registry: SessionCompactionDependencies['registry'] = {
    getLive: () => undefined,
    resolveSummary: () => undefined,
    replaceProvider: async () => undefined,
    updateSummary: (appSessionId, patch) => {
      patches.push({ appSessionId, patch });
      return undefined;
    },
  };
  const compaction = new SessionCompaction({
    registry,
    context: {
      recordCompaction: () => undefined,
      refresh: () => Promise.resolve(),
      preserveUsage: () => undefined,
    },
    timeline: {
      appendCompaction: () => undefined,
      appendStatus: () => undefined,
    },
    runtime,
    canvasTurns: new CanvasTurns(new CanvasScopes(), () => null),
    agentProcesses: {
      track: () => undefined,
      untrack: () => undefined,
      adoptDescendantsAsRoots: () => Promise.resolve(true),
    },
    interactionsFor: () => ({
      requestApproval: () => new Promise<PermissionOutcome>(() => undefined),
      requestQuestion: () => new Promise<ProviderQuestionAnswers>(() => undefined),
      cancelPending: () => undefined,
      isActive: () => true,
    }),
    emitError: () => undefined,
    isShutdownStarted: () => false,
    getFactoryDefaults: () => readDefaults(),
    maxContextTokensForModel: (modelId) => (modelId === 'unbounded' ? undefined : 1_000),
    resolveAutomaticTarget: () => undefined,
    settleAutomatic: () => undefined,
    onPrimaryNotification: () => undefined,
  });
  return {
    calls,
    compaction,
    patches,
    runtime,
    setDefaultsReader: (reader) => {
      readDefaults = reader;
    },
  };
}

function primaryTarget(
  h: Harness,
  id = 'app-1',
  configuredModelId: string | undefined = 'model-a',
): {
  session: FakeFactorySession;
  target: PrimaryCompactionTarget;
  setCurrent(value: boolean): void;
} {
  const session = new FakeFactorySession(`${id}-backend`, {}, h.calls);
  const liveSession = createCompactionTestLiveSession(id, session, h.runtime);
  let current = true;
  const target: PrimaryCompactionTarget = {
    kind: 'primary',
    appSessionId: id,
    providerSessionId: session.sessionId,
    sourceSessionId: id,
    session,
    liveSession,
    configuredModelId,
    defaultsMode: 'auto',
    isCurrent: () => current,
  };
  return { session, target, setCurrent: (value) => (current = value) };
}

function childTarget(
  h: Harness,
  effectiveModelId: string,
): {
  session: FakeFactorySession;
  target: ChildCompactionTarget;
  setCurrent(value: boolean): void;
  setModel(value: string): void;
} {
  const session = new FakeFactorySession('child-backend', {}, h.calls);
  const child = { session, childSessionId: 'child-logical', autoCompacting: false };
  let current = true;
  let modelId = effectiveModelId;
  const target: ChildCompactionTarget = {
    kind: 'child',
    appSessionId: 'app-1',
    parentAppSessionId: 'app-1',
    childSessionId: child.childSessionId,
    providerSessionId: session.sessionId,
    sourceSessionId: session.sessionId,
    session,
    role: 'worker',
    parentGeneration: 1,
    runtimeGeneration: 1,
    turnGeneration: 1,
    configurationGeneration: 1,
    isAutoCompacting: () => child.autoCompacting,
    setAutoCompacting: (active) => {
      child.autoCompacting = active;
    },
    isStreaming: () => false,
    effectiveModelId,
    isCurrent: () => current && modelId === effectiveModelId && child.session === session,
  };
  return {
    session,
    target,
    setCurrent: (value) => (current = value),
    setModel: (value) => (modelId = value),
  };
}

function settingsLimit(session: FakeFactorySession): number | undefined {
  const value = session.settings.at(-1)?.['compactionTokenLimit'];
  return typeof value === 'number' ? value : undefined;
}

function deferredDefaults(): {
  promise: Promise<FactoryDefaultSettings>;
  resolve(): void;
} {
  let resolve = (): void => undefined;
  const promise = new Promise<FactoryDefaultSettings>((done) => {
    resolve = () => done({ compactionTokenLimit: 900 });
  });
  return { promise, resolve };
}

test('limit resolution preserves UI, exposed, default, override, and window precedence', async () => {
  const h = createHarness();
  await h.compaction.updateLimits(
    { compactionTokenLimit: 600, compactionTokenLimitPerModel: { 'model-a': 400 } },
    [],
  );
  assert.equal(await h.compaction.resolveLimit({ modelId: 'model-a' }), 400);
  assert.equal(await h.compaction.resolveLimit({ modelId: 'model-b' }), 600);
  assert.equal(
    await h.compaction.resolveLimit({
      modelId: 'model-a',
      uiOverride: { compactionTokenLimit: 500 },
    }),
    400,
  );

  await h.compaction.updateLimits({}, []);
  assert.equal(
    await h.compaction.resolveLimit({
      modelId: 'model-a',
      exposed: { compactionTokenLimit: 650.9 },
    }),
    650,
  );
  await h.compaction.updateLimits(
    { compactionTokenLimit: null, compactionTokenLimitPerModel: {} },
    [],
  );
  assert.equal(await h.compaction.resolveLimit({ modelId: 'model-a' }), 800);
});

test('arm writes only while its exact target remains current, up to the provider write', async () => {
  const h = createHarness();
  const live = primaryTarget(h);
  assert.equal(await h.compaction.arm(live.target, 500), true);
  assert.equal(settingsLimit(live.session), 500);

  const abandoned = primaryTarget(h, 'abandoned');
  abandoned.setCurrent(false);
  assert.equal(await h.compaction.arm(abandoned.target, 600), false);
  assert.equal(abandoned.session.settings.length, 0);

  const pending = primaryTarget(h, 'pending');
  const gate = pending.session.deferNextUpdateSettings();
  const arming = h.compaction.arm(pending.target, 700);
  pending.setCurrent(false);
  gate.resolve();
  assert.equal(await arming, false);

  // A child invalidated by the final check before the provider write is never armed.
  const child = childTarget(h, 'model-a');
  let checks = 0;
  const lastMoment: ChildCompactionTarget = {
    ...child.target,
    isCurrent: () => {
      checks += 1;
      return checks < 3;
    },
  };
  await h.compaction.rearmModelChangedChild(lastMoment, 'model-a');
  assert.equal(checks, 3);
  assert.deepEqual(child.session.settings, []);
});

test('global retune uses each captured effective model and publishes only primary state', async () => {
  const h = createHarness();
  const primary = primaryTarget(h, 'app-1', 'primary-model');
  const child = childTarget(h, 'loaded-child-model');
  await h.compaction.updateLimits(
    {
      compactionTokenLimit: 750,
      compactionTokenLimitPerModel: {
        'primary-model': 300,
        'loaded-child-model': 450,
      },
    },
    [primary.target, child.target],
  );
  assert.equal(settingsLimit(primary.session), 300);
  assert.equal(settingsLimit(child.session), 450);
  assert.deepEqual(h.patches, [{ appSessionId: 'app-1', patch: { compactionTokenLimit: 300 } }]);
});

test('a superseded retune neither issues nor publishes stale primary state', async () => {
  // Superseded while its defaults are still loading: the provider never sees it.
  const unissued = createHarness();
  const pending = primaryTarget(unissued);
  const firstDefaults = deferredDefaults();
  unissued.setDefaultsReader(() => firstDefaults.promise);
  const stale = unissued.compaction.updateLimits({ compactionTokenLimit: 300 }, [pending.target]);
  await Promise.resolve();
  unissued.setDefaultsReader(() => Promise.resolve({ compactionTokenLimit: 900 }));
  await unissued.compaction.updateLimits({ compactionTokenLimit: 500 }, [pending.target]);
  firstDefaults.resolve();
  await stale;
  assert.deepEqual(
    pending.session.settings.map((settings) => settings['compactionTokenLimit']),
    [500],
  );
  assert.deepEqual(
    unissued.patches.map(({ patch }) => patch.compactionTokenLimit),
    [500],
  );

  // Superseded after the provider write was issued: only the newest is published.
  const issued = createHarness();
  const primary = primaryTarget(issued);
  const firstWrite = primary.session.deferNextUpdateSettings();
  const first = issued.compaction.updateLimits({ compactionTokenLimit: 300 }, [primary.target]);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(primary.session.settings.length, 1);
  await issued.compaction.updateLimits({ compactionTokenLimit: 500 }, [primary.target]);
  firstWrite.resolve();
  await first;
  assert.deepEqual(
    primary.session.settings.map((settings) => settings['compactionTokenLimit']),
    [300, 500],
  );
  assert.deepEqual(
    issued.patches.map(({ patch }) => patch.compactionTokenLimit),
    [500],
  );
});

test('child close and old-model replacement invalidate unresolved writes', async () => {
  const h = createHarness();
  const closing = childTarget(h, 'old-model');
  const closeDefaults = deferredDefaults();
  h.setDefaultsReader(() => closeDefaults.promise);
  const closingRetune = h.compaction.updateLimits({ compactionTokenLimit: 500 }, [closing.target]);
  closing.setCurrent(false);
  closeDefaults.resolve();
  await closingRetune;
  assert.equal(closing.session.settings.length, 0);

  const changing = childTarget(h, 'old-model');
  const oldDefaults = deferredDefaults();
  h.setDefaultsReader(() => oldDefaults.promise);
  const oldRetune = h.compaction.updateLimits(
    {
      compactionTokenLimitPerModel: { 'old-model': 300, 'new-model': 600 },
    },
    [changing.target],
  );
  changing.setModel('new-model');
  const replacement = childTarget(h, 'new-model');
  h.setDefaultsReader(() => Promise.resolve({}));
  await h.compaction.rearmModelChangedChild(replacement.target, 'new-model');
  oldDefaults.resolve();
  await oldRetune;
  assert.equal(changing.session.settings.length, 0);
  assert.equal(settingsLimit(replacement.session), 600);
});

test('clearAll invalidates unresolved policy work and provider arming', async () => {
  const h = createHarness();
  const primary = primaryTarget(h);
  const defaults = deferredDefaults();
  h.setDefaultsReader(() => defaults.promise);
  const retune = h.compaction.rearmPrimary(primary.target);
  h.compaction.clearAll();
  h.compaction.clearAll();
  defaults.resolve();
  await retune;
  assert.equal(primary.session.settings.length, 0);
  assert.equal(h.patches.length, 0);

  const pending = primaryTarget(h, 'pending-clear');
  const gate: StreamGate = pending.session.deferNextUpdateSettings();
  h.setDefaultsReader(() => Promise.resolve({}));
  const arming = h.compaction.arm(pending.target, 400);
  h.compaction.clearAll();
  gate.resolve();
  assert.equal(await arming, false);
});
