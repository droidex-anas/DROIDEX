import assert from 'node:assert/strict';
import test from 'node:test';

import { createSessionSettingsForAgent, SessionModelSettings } from './SessionModelSettings.js';
import type { SessionSummary } from './protocol.js';

test('agent settings map to the provider fields used by each role', () => {
  assert.deepEqual(
    createSessionSettingsForAgent('worker', { modelId: 'worker-model', reasoningEffort: 'high' }),
    { missionSettings: { workerModel: 'worker-model', workerReasoningEffort: 'high' } },
  );
  assert.deepEqual(createSessionSettingsForAgent('primary', { modelId: 'model-b' }), {
    modelId: 'model-b',
    specModeModelId: 'model-b',
  });
  assert.deepEqual(
    createSessionSettingsForAgent('primary', { modelId: 'model-b', reasoningEffort: 'high' }),
    {
      modelId: 'model-b',
      specModeModelId: 'model-b',
      reasoningEffort: 'high',
      specModeReasoningEffort: 'high',
    },
  );
});

test('clearing a live child role model requires an effective provider default', async () => {
  const summary: SessionSummary = {
    appSessionId: 'mission-provider-default',
    providerSessionId: 'mission-provider-default',
    provider: 'codex',
    sessionPurpose: 'mission-control',
    interactionMode: 'agi',
    role: 'primary',
    title: 'Mission provider default',
    goal: '',
    cwd: '',
    autonomy: 'low',
    phase: 'paused',
    modelId: 'parent-model',
    workerModelId: 'explicit-worker',
    features: [],
    tokensIn: 0,
    tokensOut: 0,
    contextTokens: 0,
    createdAt: 1,
    updatedAt: 1,
  };
  const live = { summary, session: {} };
  let childUpdates = 0;
  let summaryUpdates = 0;
  const settings = new SessionModelSettings({
    registry: {
      getLive: () => live,
      getCanonicalSummary: () => summary,
      updateSummary: () => {
        summaryUpdates += 1;
      },
    } as never,
    runtime: {} as never,
    getFactoryDefaults: async () => ({}),
    providerDefaultModelId: () => undefined,
    maxContextTokensForModel: () => undefined,
    isShutdownStarted: () => false,
    refreshPrimary: async () => undefined,
    onPrimaryModelChanged: () => undefined,
    updateChildAgentModel: async () => {
      childUpdates += 1;
      return true;
    },
    onSettled: () => undefined,
    emitError: (error) => assert.fail(error.message),
  });

  await assert.rejects(
    settings.update(summary.appSessionId, 'worker', { modelId: null }),
    /No effective worker model is available/,
  );
  assert.equal(childUpdates, 0);
  assert.equal(summaryUpdates, 0);
  assert.equal(summary.workerModelId, 'explicit-worker');
});
