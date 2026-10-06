import assert from 'node:assert/strict';
import test from 'node:test';

import type * as Protocol from './protocol.js';
import {
  createMission,
  exactSettingsEvents,
  latestSessionList,
  openChild,
} from './testing/childSettingsTestSupport.js';
import { createSessionManagerTestContext } from './testing/sessionManagerTestContext.js';

test('role child rejection leaves the parent summary truthful', async () => {
  const h = createSessionManagerTestContext();
  try {
    await createMission(h, { workerModel: 'worker-accepted' });
    const child = await openChild(h, 'worker-logical', 'worker-backend', 'worker', 'worker-old');
    const successes = exactSettingsEvents(h.events, 'provider-1', 'worker-logical').length;
    const errors = h.events.filter((event) => event.type === 'child.error').length;
    const writesBeforeRoleUpdate = child.settings.length;
    child.nextUpdateSettingsError = new Error('child role model rejected');

    await h.handle({
      type: 'settings.agent.update',
      appSessionId: 'provider-1',
      agent: 'worker',
      modelId: 'worker-role-accepted',
    });
    await h.handle({ type: 'sessions.list' });

    assert.equal(
      latestSessionList(h.events).find((session) => session.appSessionId === 'provider-1')
        ?.workerModelId,
      'worker-accepted',
    );
    assert.equal(child.settings.length, writesBeforeRoleUpdate + 1);
    assert.equal(child.settings.at(-1)?.['modelId'], 'worker-role-accepted');
    assert.equal(exactSettingsEvents(h.events, 'provider-1', 'worker-logical').length, successes);
    assert.equal(h.events.filter((event) => event.type === 'child.error').length, errors + 1);
    assert.equal(
      h.events.some(
        (event) =>
          event.type === 'error' &&
          event.appSessionId === 'provider-1' &&
          event.message.includes('live worker child sessions') &&
          event.message.includes('Retry'),
      ),
      true,
    );
  } finally {
    await h.dispose();
  }
});

test('partial role model failure warns the parent without blocking accepted siblings', async () => {
  const h = createSessionManagerTestContext();
  try {
    await createMission(h, { workerModel: 'worker-old' });
    const rejected = await openChild(
      h,
      'rejected-worker',
      'rejected-backend',
      'worker',
      'worker-old',
    );
    const accepted = await openChild(
      h,
      'accepted-worker',
      'accepted-backend',
      'worker',
      'worker-old',
    );
    const rejectedWrites = rejected.settings.length;
    rejected.nextUpdateSettingsError = new Error('worker rejected');

    await h.handle({
      type: 'settings.agent.update',
      appSessionId: 'provider-1',
      agent: 'worker',
      modelId: 'worker-new',
    });

    assert.equal(rejected.settings.length, rejectedWrites + 1);
    assert.equal(
      exactSettingsEvents(h.events, 'provider-1', 'rejected-worker').at(-1)?.modelId,
      'worker-old',
    );
    assert.equal(
      exactSettingsEvents(h.events, 'provider-1', 'accepted-worker').at(-1)?.modelId,
      'worker-new',
    );
    assert.equal(accepted.settings.at(-1)?.['compactionThresholdCheckEnabled'], true);
    assert.equal(
      h.events.some(
        (event) =>
          event.type === 'error' &&
          event.appSessionId === 'provider-1' &&
          event.message.includes('live worker child sessions'),
      ),
      true,
    );
    await h.handle({ type: 'sessions.list' });
    assert.equal(
      latestSessionList(h.events).find((session) => session.appSessionId === 'provider-1')
        ?.workerModelId,
      'worker-old',
    );

    await h.handle({
      type: 'settings.agent.update',
      appSessionId: 'provider-1',
      agent: 'worker',
      modelId: 'worker-new',
    });
    assert.equal(
      exactSettingsEvents(h.events, 'provider-1', 'rejected-worker').at(-1)?.modelId,
      'worker-new',
    );
    await h.handle({ type: 'sessions.list' });
    assert.equal(
      latestSessionList(h.events).find((session) => session.appSessionId === 'provider-1')
        ?.workerModelId,
      'worker-new',
    );
  } finally {
    await h.dispose();
  }
});

test('clearing a Droid role model without a default fails before parent or child writes', async () => {
  let defaults: Protocol.FactoryDefaultSettings = {
    modelId: 'model-default',
    workerModelId: 'worker-default',
    validatorModelId: 'validator-default',
  };
  const h = createSessionManagerTestContext({ getFactoryDefaults: async () => defaults });
  try {
    await createMission(h, { workerModel: 'worker-old', validatorModel: 'validator-old' });
    const worker = await openChild(h, 'worker-logical', 'worker-backend', 'worker', 'worker-old');
    const validator = await openChild(
      h,
      'validator-logical',
      'validator-backend',
      'validator',
      'validator-old',
    );
    const parent = h.provider.session('provider-1');
    const writes = [parent.settings.length, worker.settings.length, validator.settings.length];
    defaults = {};

    for (const agent of ['worker', 'validator'] as const)
      await h.handle({
        type: 'settings.agent.update',
        appSessionId: 'provider-1',
        agent,
        modelId: null,
      });

    assert.deepEqual(
      [parent.settings.length, worker.settings.length, validator.settings.length],
      writes,
    );
    await h.handle({ type: 'sessions.list' });
    const summary = latestSessionList(h.events).find(
      (session) => session.appSessionId === 'provider-1',
    );
    assert.equal(summary?.workerModelId, 'worker-old');
    assert.equal(summary?.validatorModelId, 'validator-old');
    assert.equal(
      h.events.filter(
        (event) => event.type === 'error' && event.message.includes('default model is unavailable'),
      ).length,
      2,
    );
  } finally {
    await h.dispose();
  }
});

test(
  'role model changes queue behind accepted in-flight exact child settings',
  { concurrency: false },
  async () => {
    const h = createSessionManagerTestContext();
    try {
      await createMission(h);
      const child = await openChild(h, 'worker-logical', 'worker-backend', 'worker', 'worker-old');
      await h.handle({
        type: 'settings.compaction.update',
        compactionTokenLimit: 700,
        compactionTokenLimitPerModel: {
          'exact-model': 211,
          'role-model': 311,
        },
      });
      const writesBefore = child.settings.length;
      const gate = h.provider.deferNextUpdateSettings('worker-backend');
      const exactUpdate = h.handle({
        type: 'child.updateSettings',
        parentAppSessionId: 'provider-1',
        childSessionId: 'worker-logical',
        modelId: 'exact-model',
        reasoningEffort: 'high',
      });
      await child.waitForSettings(writesBefore + 1);

      const roleUpdate = h.handle({
        type: 'settings.agent.update',
        appSessionId: 'provider-1',
        agent: 'worker',
        modelId: 'role-model',
      });
      await h.waitForIdle();

      assert.deepEqual(
        child.settings.slice(writesBefore).map((settings) => settings['modelId']),
        ['exact-model'],
      );

      gate.resolve();
      await Promise.all([exactUpdate, roleUpdate]);

      assert.deepEqual(
        child.settings.slice(writesBefore).map((settings) => ({
          modelId: settings['modelId'],
          reasoningEffort: settings['reasoningEffort'],
          limit: settings['compactionTokenLimit'],
        })),
        [
          { modelId: 'exact-model', reasoningEffort: 'high', limit: undefined },
          { modelId: undefined, reasoningEffort: undefined, limit: 211 },
          { modelId: 'role-model', reasoningEffort: undefined, limit: undefined },
          { modelId: undefined, reasoningEffort: undefined, limit: 311 },
        ],
      );
      const accepted = exactSettingsEvents(h.events, 'provider-1', 'worker-logical').at(-1);
      assert.equal(accepted?.modelId, 'role-model');
      assert.equal(accepted?.reasoningEffort, 'high');
    } finally {
      await h.dispose();
    }
  },
);
