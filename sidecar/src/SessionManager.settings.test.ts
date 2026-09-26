import assert from 'node:assert/strict';
import test from 'node:test';

import { startupFactoryDefaults, validateFactoryDefaults } from './SessionManager.js';
import { claudeContextEnv, claudeContextModel } from './providers/claude/claudeContextWindow.js';
import { buildCreatedSessionSummary, resumeSettings } from './sessionHelpers.js';
import { createSessionSettingsForAgent } from './SessionModelSettings.js';
import type { ModelInfo } from './protocol.js';

const models: ModelInfo[] = [
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

test('agent settings map to the provider fields used by each role', () => {
  assert.deepEqual(
    createSessionSettingsForAgent('worker', {
      modelId: 'worker-model',
      reasoningEffort: 'high',
    }),
    {
      missionSettings: {
        workerModel: 'worker-model',
        workerReasoningEffort: 'high',
      },
    },
  );
  assert.deepEqual(createSessionSettingsForAgent('primary', { modelId: 'model-b' }), {
    modelId: 'model-b',
    specModeModelId: 'model-b',
  });
  assert.deepEqual(
    createSessionSettingsForAgent('primary', {
      modelId: 'model-b',
      reasoningEffort: 'high',
    }),
    {
      modelId: 'model-b',
      specModeModelId: 'model-b',
      reasoningEffort: 'high',
      specModeReasoningEffort: 'high',
    },
  );
});

test('startup defaults omit model ids until a catalog validates them', () => {
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
});

test('Factory defaults are validated against the available model catalog', () => {
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
});

test('saved model defaults remain intact while the catalog is unavailable', () => {
  assert.deepEqual(
    validateFactoryDefaults(
      {
        modelId: 'saved-model',
        reasoningEffort: 'high',
        specModelId: 'saved-spec-model',
        workerModelId: 'saved-worker',
        validatorModelId: 'saved-validator',
        compactionModel: 'saved-compaction-model',
        compactionTokenLimit: 200_000.9,
        compactionTokenLimitPerModel: { 'saved-model': 150_000.5 },
      },
      [],
    ),
    {
      modelId: 'saved-model',
      reasoningEffort: 'high',
      specModelId: 'saved-spec-model',
      workerModelId: 'saved-worker',
      validatorModelId: 'saved-validator',
      compactionModel: 'saved-compaction-model',
      compactionTokenLimit: 200_000,
      compactionTokenLimitPerModel: { 'saved-model': 150_000 },
    },
  );
});

test('Claude context choices round-trip suffixes and isolate the 200k launch environment', () => {
  const catalog = [
    {
      value: 'sonnet',
      resolvedModel: 'claude-sonnet-4-6',
      displayName: 'Sonnet',
      description: 'Standard context',
    },
    { value: 'sonnet[1m]', displayName: 'Sonnet (1M context)', description: 'Extended context' },
    { value: 'native', displayName: 'Native (1M context)', description: '1M context window' },
  ];
  assert.equal(claudeContextModel('sonnet', 1000000, catalog), 'sonnet[1m]');
  assert.equal(claudeContextModel('claude-sonnet-4-6', 1000000, catalog), 'sonnet[1m]');
  assert.equal(claudeContextModel('sonnet[1M]', 200000, catalog), 'sonnet');
  assert.equal(claudeContextModel('sonnet[1m]', undefined, catalog), 'sonnet[1m]');
  assert.equal(claudeContextModel('native', 1000000, catalog), 'native');
  assert.throws(() => claudeContextModel('haiku', 1000000, catalog), /unavailable/);
  const env = { CLAUDE_CODE_DISABLE_1M_CONTEXT: 'global', PATH: '/bin' };
  assert.deepEqual(claudeContextEnv(env, 200000), { ...env, CLAUDE_CODE_DISABLE_1M_CONTEXT: '1' });
  assert.deepEqual(claudeContextEnv(env, 1000000), { PATH: '/bin' });
  assert.deepEqual(claudeContextEnv(env, undefined), env);
  assert.equal(env.CLAUDE_CODE_DISABLE_1M_CONTEXT, 'global');
  const session = buildCreatedSessionSummary({
    command: {
      type: 'session.create',
      clientRef: 'window',
      title: 'Window',
      goal: '',
      sessionPurpose: 'chat',
      autonomy: 'low',
      contextWindowTokens: 1000000,
    },
    appSessionId: 'window',
    interactionMode: 'auto',
    primary: { modelId: 'sonnet[1m]' },
    agents: {},
    autonomy: 'low',
    provider: 'claude',
    compactionModel: 'current-model',
    now: 1,
  });
  assert.deepEqual(resumeSettings(session), {
    modelId: 'sonnet[1m]',
    contextWindowTokens: 1000000,
    autonomy: 'low',
  });
});
