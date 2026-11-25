import assert from 'node:assert/strict';
import test from 'node:test';

import type * as Protocol from '@droidex/protocol';
import { startupFactoryDefaults, validateFactoryDefaults } from './factoryDefaults.js';

test('Factory defaults keep model ids only once a catalog validates them', () => {
  const models: Protocol.ModelInfo[] = [
    {
      id: 'model-a',
      displayName: 'Model A',
      isDefault: true,
      isCustom: false,
      supportedReasoningEfforts: ['low', 'medium'],
      defaultReasoningEffort: 'medium',
    },
    {
      id: 'model-b',
      displayName: 'Model B',
      isCustom: false,
      supportedReasoningEfforts: ['high'],
      defaultReasoningEffort: 'high',
    },
  ];
  assert.deepEqual(
    startupFactoryDefaults(
      {
        modelId: 'missing-model',
        reasoningEffort: 'high',
        compactionModel: 'missing-model',
        compactionTokenLimit: 200_000,
        compactionTokenLimitPerModel: { 'missing-model': 150_000 },
        autonomy: 'high',
        interactionMode: 'auto',
        workerModelId: 'missing-worker',
      },
      [],
    ),
    {
      autonomy: 'high',
      interactionMode: 'auto',
      compactionTokenLimit: 200_000,
      compactionTokenLimitPerModel: { 'missing-model': 150_000 },
    },
  );
  assert.deepEqual(
    validateFactoryDefaults(
      {
        modelId: 'missing-model',
        reasoningEffort: 'high',
        compactionModel: 'missing-model',
        compactionTokenLimit: 200_000,
        compactionTokenLimitPerModel: { 'model-b': 150_000, missing: 90_000 },
        specModelId: 'model-b',
        specReasoningEffort: 'low',
        workerModelId: 'model-b',
        workerReasoningEffort: 'medium',
        validatorModelId: 'missing-validator',
      },
      models,
    ),
    {
      modelId: 'model-a',
      reasoningEffort: 'medium',
      compactionModel: 'current-model',
      compactionTokenLimit: 200_000,
      compactionTokenLimitPerModel: { 'model-b': 150_000 },
      specModelId: 'model-b',
      specReasoningEffort: 'high',
      workerModelId: 'model-b',
      workerReasoningEffort: 'high',
      validatorModelId: 'model-a',
      validatorReasoningEffort: undefined,
    },
  );
  // Saved defaults remain intact while the catalog is unavailable.
  const saved = {
    modelId: 'saved-model',
    reasoningEffort: 'high',
    specModelId: 'saved-spec-model',
    workerModelId: 'saved-worker',
    validatorModelId: 'saved-validator',
    compactionModel: 'saved-compaction-model',
  } as const;
  assert.deepEqual(
    validateFactoryDefaults(
      {
        ...saved,
        compactionTokenLimit: 200_000.9,
        compactionTokenLimitPerModel: { 'saved-model': 150_000.5 },
      },
      [],
    ),
    {
      ...saved,
      compactionTokenLimit: 200_000,
      compactionTokenLimitPerModel: { 'saved-model': 150_000 },
    },
  );
});
