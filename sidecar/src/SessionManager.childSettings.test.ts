import assert from 'node:assert/strict';
import test from 'node:test';
import { ProgressLogEntryType } from '@factory/droid-sdk';

import type { ClientCommand, FactoryDefaultSettings, ServerEvent } from './protocol.js';
import {
  createMission,
  exactSettingsEvents,
  latestSessionList,
  openChild,
  openChildForParent,
} from './testing/childSettingsTestSupport.js';
import { FakeFactorySession } from './testing/fakeFactoryRuntime.js';
import {
  createSessionManagerTestContext,
  type SessionManagerTestContext,
} from './testing/sessionManagerTestContext.js';

function invalidTargetErrors(
  events: ServerEvent[],
  parentAppSessionId: string,
  childSessionId: string,
): number {
  return events.filter(
    (event) =>
      event.type === 'child.error' &&
      event.code === 'child.settings_target_invalid' &&
      event.parentAppSessionId === parentAppSessionId &&
      event.childSessionId === childSessionId,
  ).length;
}

async function completeWorker(
  h: SessionManagerTestContext,
  workerSessionId: string,
): Promise<void> {
  h.provider.session('provider-1').queueStreamEvents([
    {
      type: 'mission_progress_entry',
      progressLog: [
        {
          type: ProgressLogEntryType.WorkerStarted,
          timestamp: '2026-07-29T00:00:00.000Z',
          workerSessionId,
          spawnId: 'spawn-worker-logical',
        },
      ],
    },
    { type: 'mission_worker_completed', workerSessionId, exitCode: 0 },
  ]);
  await h.handle({ type: 'session.send', appSessionId: 'provider-1', text: 'settle worker' });
}

test('exact child settings target only the resolved worker or validator backend', async () => {
  const h = createSessionManagerTestContext();
  try {
    await createMission(h, {
      workerModel: 'worker-role-default',
      validatorModel: 'validator-role-default',
    });
    const workerA = await openChild(
      h,
      'worker-logical-a',
      'worker-backend-a',
      'worker',
      'worker-old-a',
    );
    const workerB = await openChild(
      h,
      'worker-logical-b',
      'worker-backend-b',
      'worker',
      'worker-old-b',
    );
    const validator = await openChild(
      h,
      'validator-logical',
      'validator-backend',
      'validator',
      'validator-old',
    );
    await h.handle({
      type: 'settings.compaction.update',
      compactionTokenLimit: 700,
      compactionTokenLimitPerModel: {
        'worker-new': 211,
        'validator-new': 311,
      },
    });
    const parentProvider = h.provider.session('provider-1');
    const before = [
      workerA.settings.length,
      workerB.settings.length,
      validator.settings.length,
      parentProvider.settings.length,
    ];

    await h.handle({
      type: 'child.updateSettings',
      parentAppSessionId: 'provider-1',
      childSessionId: 'worker-logical-a',
      modelId: 'worker-new',
      reasoningEffort: 'high',
    });

    assert.deepEqual(
      workerA.settings.slice(before[0]).map((settings) => ({
        modelId: settings['modelId'],
        reasoningEffort: settings['reasoningEffort'],
        limit: settings['compactionTokenLimit'],
      })),
      [
        { modelId: 'worker-new', reasoningEffort: 'high', limit: undefined },
        { modelId: undefined, reasoningEffort: undefined, limit: 211 },
      ],
    );
    assert.equal(workerB.settings.length, before[1]);
    assert.equal(validator.settings.length, before[2]);
    assert.equal(parentProvider.settings.length, before[3]);
    const workerEvent = exactSettingsEvents(h.events, 'provider-1', 'worker-logical-a').at(-1);
    assert.ok(workerEvent);
    assert.equal(workerEvent.parentAppSessionId, 'provider-1');
    assert.equal(workerEvent.modelId, 'worker-new');
    assert.equal('providerSessionId' in workerEvent, false);

    await h.handle({
      type: 'settings.compaction.update',
      compactionTokenLimit: 700,
      compactionTokenLimitPerModel: {
        'worker-new': 411,
        'validator-new': 311,
      },
    });
    assert.equal(workerA.settings.at(-1)?.['compactionTokenLimit'], 411);

    const validatorBefore = validator.settings.length;
    const parentBeforeValidator = parentProvider.settings.length;
    await h.handle({
      type: 'child.updateSettings',
      parentAppSessionId: 'provider-1',
      childSessionId: 'validator-logical',
      modelId: 'validator-new',
    });
    assert.deepEqual(
      validator.settings.slice(validatorBefore).map((settings) => ({
        modelId: settings['modelId'],
        limit: settings['compactionTokenLimit'],
      })),
      [
        { modelId: 'validator-new', limit: undefined },
        { modelId: undefined, limit: 311 },
      ],
    );
    assert.equal(parentProvider.settings.length, parentBeforeValidator);

    await h.handle({ type: 'sessions.list' });
    const parent = latestSessionList(h.events).find(
      (session) => session.appSessionId === 'provider-1',
    );
    assert.equal(parent?.workerModelId, 'worker-role-default');
    assert.equal(parent?.validatorModelId, 'validator-role-default');
  } finally {
    await h.dispose();
  }
});

test('child default reset prefers the parent role model then the validated Factory role default', async () => {
  const explicit = createSessionManagerTestContext();
  try {
    await createMission(explicit, { workerModel: 'worker-role-default' });
    const child = await openChild(
      explicit,
      'worker-logical',
      'worker-backend',
      'worker',
      'worker-old',
    );
    await explicit.handle({
      type: 'settings.compaction.update',
      compactionTokenLimit: 700,
      compactionTokenLimitPerModel: {
        'worker-role-default': 271,
        'worker-old': 171,
      },
    });
    await explicit.handle({
      type: 'child.updateSettings',
      parentAppSessionId: 'provider-1',
      childSessionId: 'worker-logical',
      modelId: null,
    });
    assert.equal(child.settings.at(-2)?.['modelId'], 'worker-role-default');
    assert.equal(child.settings.at(-1)?.['compactionTokenLimit'], 271);
  } finally {
    await explicit.dispose();
  }

  const fallback = createSessionManagerTestContext();
  try {
    await createMission(fallback);
    const child = await openChild(
      fallback,
      'validator-logical',
      'validator-backend',
      'validator',
      'validator-old',
    );
    await fallback.handle({
      type: 'settings.compaction.update',
      compactionTokenLimit: 700,
      compactionTokenLimitPerModel: {
        'model-default': 381,
        'validator-old': 181,
      },
    });
    await fallback.handle({
      type: 'child.updateSettings',
      parentAppSessionId: 'provider-1',
      childSessionId: 'validator-logical',
      modelId: null,
    });
    assert.equal(child.settings.at(-2)?.['modelId'], 'model-default');
    assert.equal(child.settings.at(-1)?.['compactionTokenLimit'], 381);
  } finally {
    await fallback.dispose();
  }
});

test('a parent provider alias is never accepted as parentAppSessionId', async () => {
  const h = createSessionManagerTestContext();
  try {
    await createMission(h);
    const parent = h.provider.session('provider-1');
    parent.nextCompactResult = { newSessionId: 'parent-backend', removedCount: 1 };
    h.runtime.loadQueue.set('parent-backend', [
      new FakeFactorySession('parent-backend', {}, h.calls),
    ]);
    await h.handle({ type: 'session.compact', appSessionId: 'provider-1' });
    const child = new FakeFactorySession('child-backend', {}, h.calls);
    child.setInitModel('worker-old');
    h.history.seedChildSessions([
      {
        parentAppSessionId: 'provider-1',
        childSessionId: 'child-logical',
        providerSessionId: 'child-backend',
        role: 'worker',
        status: 'paused',
        modelId: 'worker-old',
        transcriptAvailable: true,
        updatedAt: Date.now(),
      },
    ]);
    h.runtime.loadQueue.set('child-backend', [child]);
    await h.handle({
      type: 'child.open',
      parentAppSessionId: 'provider-1',
      childSessionId: 'child-logical',
      requestId: 'open-child-logical',
    });
    const writes = child.settings.length;

    await h.handle({
      type: 'child.updateSettings',
      parentAppSessionId: 'parent-backend',
      childSessionId: 'child-logical',
      modelId: 'must-not-apply',
    });
    assert.equal(child.settings.length, writes);

    await h.handle({
      type: 'child.updateSettings',
      parentAppSessionId: 'provider-1',
      childSessionId: 'child-logical',
      modelId: 'worker-new',
    });
    assert.equal(
      child.settings.slice(writes)[0]?.['modelId'],
      'worker-new',
      JSON.stringify(h.events.filter((event) => event.type === 'child.error')),
    );
  } finally {
    await h.dispose();
  }
});

test('child settings reject every target that is not a live exact child of the parent', async () => {
  const h = createSessionManagerTestContext();
  try {
    await createMission(h);
    const child = await openChild(h, 'worker-logical', 'worker-backend', 'worker', 'worker-old');
    const writes = child.settings.length;
    const parentWrites = h.provider.session('provider-1').settings.length;
    const successes = exactSettingsEvents(h.events, 'provider-1', 'worker-logical').length;
    const rejected: [string, ClientCommand][] = [
      [
        'the backend provider id is not the child command identity',
        {
          type: 'child.updateSettings',
          parentAppSessionId: 'provider-1',
          childSessionId: 'worker-backend',
          modelId: 'must-not-apply',
        },
      ],
      [
        'a model-less command is malformed',
        {
          type: 'child.updateSettings',
          parentAppSessionId: 'provider-1',
          childSessionId: 'worker-logical',
          reasoningEffort: 'high',
        } as unknown as ClientCommand,
      ],
      [
        'an unknown child is not a target',
        {
          type: 'child.updateSettings',
          parentAppSessionId: 'provider-1',
          childSessionId: 'unknown-child',
          modelId: 'must-not-apply',
        },
      ],
    ];
    for (const [reason, command] of rejected) {
      const childSessionId = (command as { childSessionId: string }).childSessionId;
      const errors = invalidTargetErrors(h.events, 'provider-1', childSessionId);
      await h.handle(command);
      assert.equal(child.settings.length, writes, reason);
      assert.equal(invalidTargetErrors(h.events, 'provider-1', childSessionId), errors + 1, reason);
    }
    assert.equal(h.provider.session('provider-1').settings.length, parentWrites);
    assert.equal(exactSettingsEvents(h.events, 'provider-1', 'worker-logical').length, successes);

    // An unknown child cannot be opened into the parent's child map either.
    const loads = h.runtime.loadCalls.length;
    await h.handle({
      type: 'child.open',
      parentAppSessionId: 'provider-1',
      childSessionId: 'unknown-child',
      requestId: 'open-unknown-child',
    });
    assert.equal(h.runtime.loadCalls.length, loads);
    assert.equal(
      h.events.some(
        (event) =>
          event.type === 'child.error' &&
          event.code === 'child.not_in_session' &&
          event.childSessionId === 'unknown-child',
      ),
      true,
    );

    // A completed child is no longer a settings target.
    await completeWorker(h, 'worker-backend');
    const errors = invalidTargetErrors(h.events, 'provider-1', 'worker-logical');
    await h.handle({
      type: 'child.updateSettings',
      parentAppSessionId: 'provider-1',
      childSessionId: 'worker-logical',
      modelId: 'must-not-apply',
    });
    assert.equal(child.settings.length, writes);
    assert.equal(invalidTargetErrors(h.events, 'provider-1', 'worker-logical'), errors + 1);
  } finally {
    await h.dispose();
  }
});

test('concurrent child settings updates serialize so the latest selection wins', async () => {
  const h = createSessionManagerTestContext();
  try {
    await createMission(h);
    const child = await openChild(h, 'worker-logical', 'worker-backend', 'worker', 'worker-old');
    const firstGate = h.provider.deferNextUpdateSettings('worker-backend');
    const writesBefore = child.settings.length;

    const first = h.handle({
      type: 'child.updateSettings',
      parentAppSessionId: 'provider-1',
      childSessionId: 'worker-logical',
      modelId: 'worker-first',
    });
    await h.waitForIdle();
    const second = h.handle({
      type: 'child.updateSettings',
      parentAppSessionId: 'provider-1',
      childSessionId: 'worker-logical',
      modelId: 'worker-latest',
    });
    await h.waitForIdle();

    assert.deepEqual(
      child.settings
        .slice(writesBefore)
        .filter((settings) => settings['modelId'])
        .map((settings) => settings['modelId']),
      ['worker-first'],
    );

    firstGate.resolve();
    await Promise.all([first, second]);

    assert.deepEqual(
      child.settings
        .slice(writesBefore)
        .filter((settings) => settings['modelId'])
        .map((settings) => settings['modelId']),
      ['worker-first', 'worker-latest'],
    );
    assert.equal(
      exactSettingsEvents(h.events, 'provider-1', 'worker-logical').at(-1)?.modelId,
      'worker-latest',
    );
  } finally {
    await h.dispose();
  }
});

test('provider rejection commits no child success or compaction re-arm and role-default rejection stays truthful', async () => {
  const h = createSessionManagerTestContext();
  try {
    await createMission(h, { workerModel: 'worker-accepted' });
    const child = await openChild(h, 'worker-logical', 'worker-backend', 'worker', 'worker-old');
    const successes = exactSettingsEvents(h.events, 'provider-1', 'worker-logical').length;
    const writes = child.settings.length;
    child.nextUpdateSettingsError = new Error('child provider rejected');

    await h.handle({
      type: 'child.updateSettings',
      parentAppSessionId: 'provider-1',
      childSessionId: 'worker-logical',
      modelId: 'worker-rejected',
    });

    assert.equal(child.settings.length, writes + 1);
    assert.equal(child.settings.at(-1)?.['modelId'], 'worker-rejected');
    assert.equal(exactSettingsEvents(h.events, 'provider-1', 'worker-logical').length, successes);
    assert.equal(
      h.events.some(
        (event) =>
          event.type === 'child.error' &&
          event.code === 'child.settings_update_failed' &&
          event.parentAppSessionId === 'provider-1' &&
          event.childSessionId === 'worker-logical',
      ),
      true,
    );

    const parent = h.provider.session('provider-1');
    parent.nextUpdateSettingsError = new Error('role default rejected');
    await h.handle({
      type: 'settings.agent.update',
      appSessionId: 'provider-1',
      agent: 'worker',
      modelId: 'worker-false-projection',
    });
    await h.handle({ type: 'sessions.list' });
    assert.equal(
      latestSessionList(h.events).find((session) => session.appSessionId === 'provider-1')
        ?.workerModelId,
      'worker-accepted',
    );
  } finally {
    await h.dispose();
  }
});

test('a child settings completion after parent close cannot publish or re-arm', async () => {
  const h = createSessionManagerTestContext();
  try {
    await createMission(h);
    const child = await openChild(h, 'worker-logical', 'worker-backend', 'worker', 'worker-old');
    const gate = h.provider.deferNextUpdateSettings('worker-backend');
    const successes = exactSettingsEvents(h.events, 'provider-1', 'worker-logical').length;
    const update = h.handle({
      type: 'child.updateSettings',
      parentAppSessionId: 'provider-1',
      childSessionId: 'worker-logical',
      modelId: 'worker-late',
    });
    await h.waitForIdle();
    assert.equal(child.settings.at(-1)?.['modelId'], 'worker-late');
    const writesAfterProvider = child.settings.length;

    const closing = h.handle({ type: 'session.close', appSessionId: 'provider-1' });
    await h.waitForIdle();
    assert.equal(
      h.calls.some(
        (call) =>
          call.target === 'cleanup' &&
          call.method === 'session.close' &&
          call.args[0] === 'worker-backend',
      ),
      false,
    );
    gate.resolve();
    await Promise.all([update, closing]);

    assert.equal(exactSettingsEvents(h.events, 'provider-1', 'worker-logical').length, successes);
    assert.equal(child.settings.length, writesAfterProvider);
  } finally {
    await h.dispose();
  }
});

test('a child completed during limit resolution receives no compaction write', async () => {
  const defaults: FactoryDefaultSettings = {
    modelId: 'model-default',
    workerModelId: 'worker-default',
    validatorModelId: 'validator-default',
    interactionMode: 'auto',
    autonomy: 'low',
  };
  let readDefaults = (): Promise<FactoryDefaultSettings> => Promise.resolve(defaults);
  let releaseDefaults = (): void => undefined;
  const h = createSessionManagerTestContext({
    getFactoryDefaults: () => readDefaults(),
  });
  try {
    await createMission(h);
    const child = await openChild(h, 'worker-logical', 'worker-backend', 'worker', 'worker-old');
    h.provider.emitNotification('worker-backend', {
      jsonrpc: '2.0',
      method: 'droid.session_notification',
      params: {
        notification: {
          type: 'droid_working_state_changed',
          newState: 'compacting_conversation',
        },
      },
    });

    const blockedDefaults = new Promise<FactoryDefaultSettings>((resolve) => {
      releaseDefaults = () => resolve(defaults);
    });
    readDefaults = () => blockedDefaults;
    const writesBefore = child.settings.length;
    const update = h.handle({
      type: 'child.updateSettings',
      parentAppSessionId: 'provider-1',
      childSessionId: 'worker-logical',
      modelId: 'worker-new',
    });
    await h.waitForIdle();
    assert.equal(child.settings.length, writesBefore + 1);
    assert.equal(child.settings.at(-1)?.['modelId'], 'worker-new');

    await completeWorker(h, 'worker-backend');
    assert.equal(
      h.events.some(
        (event) =>
          event.type === 'session.child' &&
          event.child.childSessionId === 'worker-logical' &&
          event.child.status === 'completed',
      ),
      true,
    );
    const writesAfterCompletion = child.settings.length;

    releaseDefaults();
    await update;
    assert.equal(child.settings.length, writesAfterCompletion);
  } finally {
    releaseDefaults();
    await h.dispose();
  }
});

test('child open emits no settings readiness after the parent closes', async () => {
  const h = createSessionManagerTestContext();
  try {
    await createMission(h);
    const child = new FakeFactorySession('worker-backend', {}, h.calls);
    child.setInitModel('worker-old');
    const gate = child.deferNextUpdateSettings();
    h.history.seedChildSessions([
      {
        parentAppSessionId: 'provider-1',
        childSessionId: 'worker-logical',
        providerSessionId: 'worker-backend',
        role: 'worker',
        status: 'paused',
        modelId: 'worker-old',
        transcriptAvailable: true,
        updatedAt: Date.now(),
      },
    ]);
    h.runtime.loadQueue.set('worker-backend', [child]);

    const opening = h.handle({
      type: 'child.open',
      parentAppSessionId: 'provider-1',
      childSessionId: 'worker-logical',
      requestId: 'open-worker-logical',
    });
    await h.waitForIdle();
    await h.handle({ type: 'session.close', appSessionId: 'provider-1' });
    gate.resolve();
    await opening;

    assert.equal(
      h.events.some(
        (event) =>
          event.type === 'child.updated' &&
          event.childSessionId === 'worker-logical' &&
          event.access === 'ready',
      ),
      false,
    );
    assert.equal(
      h.calls.filter(
        (call) =>
          call.target === 'cleanup' &&
          call.method === 'session.close' &&
          call.args[0] === 'worker-backend',
      ).length,
      1,
    );
  } finally {
    await h.dispose();
  }
});

test('an exact child model acceptance invalidates a captured old-model global retune', async () => {
  const defaults: FactoryDefaultSettings = {
    modelId: 'model-default',
    workerModelId: 'worker-default',
    validatorModelId: 'validator-default',
    interactionMode: 'auto',
    autonomy: 'low',
  };
  let readDefaults = (): Promise<FactoryDefaultSettings> => Promise.resolve(defaults);
  let releaseDefaults = (): void => undefined;
  const h = createSessionManagerTestContext({
    getFactoryDefaults: () => readDefaults(),
  });
  try {
    await createMission(h);
    const child = await openChild(h, 'worker-logical', 'worker-backend', 'worker', 'old-model');
    const blockedDefaults = new Promise<FactoryDefaultSettings>((resolve) => {
      releaseDefaults = () => resolve(defaults);
    });
    readDefaults = () => blockedDefaults;
    const globalRetune = h.handle({
      type: 'settings.compaction.update',
      compactionTokenLimit: 900,
      compactionTokenLimitPerModel: {
        'old-model': 300,
        'new-model': 600,
      },
    });
    await h.waitForIdle();
    readDefaults = () => Promise.resolve(defaults);

    await h.handle({
      type: 'child.updateSettings',
      parentAppSessionId: 'provider-1',
      childSessionId: 'worker-logical',
      modelId: 'new-model',
    });
    const writesAfterAcceptance = child.settings.length;
    assert.deepEqual(
      child.settings.slice(-2).map((settings) => ({
        modelId: settings['modelId'],
        limit: settings['compactionTokenLimit'],
      })),
      [
        { modelId: 'new-model', limit: undefined },
        { modelId: undefined, limit: 600 },
      ],
    );

    releaseDefaults();
    await globalRetune;

    assert.equal(child.settings.length, writesAfterAcceptance);
    assert.equal(child.settings.at(-1)?.['compactionTokenLimit'], 600);
  } finally {
    releaseDefaults();
    await h.dispose();
  }
});

test('a closing parent rejects exact child settings before provider issue', async () => {
  const h = createSessionManagerTestContext();
  try {
    await createMission(h);
    const parent = h.provider.session('provider-1');
    const child = await openChild(h, 'worker-logical', 'worker-backend', 'worker', 'worker-old');
    const closeGate = parent.deferNextClose();
    const closing = h.handle({ type: 'session.close', appSessionId: 'provider-1' });
    await h.waitForIdle();
    const writes = child.settings.length;

    await h.handle({
      type: 'child.updateSettings',
      parentAppSessionId: 'provider-1',
      childSessionId: 'worker-logical',
      modelId: 'must-not-apply',
    });

    assert.equal(child.settings.length, writes);
    assert.equal(invalidTargetErrors(h.events, 'provider-1', 'worker-logical'), 1);
    closeGate.resolve();
    await closing;
  } finally {
    await h.dispose().catch(() => undefined);
  }
});

test('the same child identity under another parent is not interchangeable', async () => {
  const h = createSessionManagerTestContext();
  try {
    await createMission(h);
    await createMission(h);
    const first = await openChildForParent(h, 'provider-1', {
      childSessionId: 'shared-logical',
      providerSessionId: 'worker-backend-1',
      role: 'worker',
      modelId: 'worker-old',
    });
    const second = await openChildForParent(h, 'provider-2', {
      childSessionId: 'shared-logical',
      providerSessionId: 'worker-backend-2',
      role: 'worker',
      modelId: 'worker-old',
    });
    const firstWrites = first.settings.length;
    const secondWrites = second.settings.length;

    await h.handle({
      type: 'child.updateSettings',
      parentAppSessionId: 'provider-2',
      childSessionId: 'shared-logical',
      modelId: 'second-only',
    });

    assert.equal(first.settings.length, firstWrites);
    assert.deepEqual(
      second.settings.slice(secondWrites).map((settings) => ({
        modelId: settings['modelId'],
        limit: settings['compactionTokenLimit'],
      })),
      [
        { modelId: 'second-only', limit: undefined },
        { modelId: undefined, limit: 250_000 },
      ],
    );
    assert.equal(
      exactSettingsEvents(h.events, 'provider-1', 'shared-logical').at(-1)?.modelId,
      'worker-old',
    );
    assert.equal(
      exactSettingsEvents(h.events, 'provider-2', 'shared-logical').at(-1)?.modelId,
      'second-only',
    );
  } finally {
    await h.dispose();
  }
});
