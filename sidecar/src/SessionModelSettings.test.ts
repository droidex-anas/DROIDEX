import assert from 'node:assert/strict';
import test from 'node:test';

import { createSessionSettingsForAgent } from './SessionModelSettings.js';

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
