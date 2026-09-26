import assert from 'node:assert/strict';
import test from 'node:test';

import { startupFactoryDefaults, validateFactoryDefaults } from './SessionManager.js';
import { createSessionSettingsForAgent } from './SessionModelSettings.js';
import { createSessionManagerTestContext } from './testing/sessionManagerTestContext.js';
import { ProviderTranscriptFile } from './providers/ProviderTranscriptFile.js';
import { resumeSettings } from './sessionHelpers.js';
import type { ModelInfo, SessionSummary } from './protocol.js';

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

test('closed provider sessions preserve fast-only, explicit off and omitted settings updates', async () => {
  const h = createSessionManagerTestContext();
  const stored: SessionSummary = {
    appSessionId: 'stored-fast',
    providerSessionId: 'stored-fast',
    provider: 'codex',
    resumeId: 'thread-fast',
    sessionPurpose: 'chat',
    interactionMode: 'auto',
    role: 'primary',
    title: 'Fast settings',
    goal: '',
    cwd: '',
    autonomy: 'low',
    phase: 'paused',
    modelId: 'model-default',
    reasoningEffort: 'high',
    fastMode: false,
    features: [],
    tokensIn: 0,
    tokensOut: 0,
    contextTokens: 0,
    createdAt: 1,
    updatedAt: 1,
  };
  try {
    const transcript = new ProviderTranscriptFile(stored.appSessionId, () => stored);
    transcript.appendPrompt('hello');
    transcript.append({
      id: 'reply',
      appSessionId: stored.appSessionId,
      sourceSessionId: stored.appSessionId,
      role: 'primary',
      kind: 'text',
      text: 'hello',
      ts: 1,
    });
    transcript.flush();
    h.fixture.seedHistorySummaries([stored]);
    await h.handle({
      type: 'session.updateSettings',
      appSessionId: stored.appSessionId,
      fastMode: true,
    });
    assert.equal(
      h.history.summaryPatchesAndHidden().patches.get(stored.appSessionId)?.fastMode,
      true,
    );
    await h.handle({
      type: 'session.updateSettings',
      appSessionId: stored.appSessionId,
      fastMode: false,
    });
    await h.handle({
      type: 'session.updateSettings',
      appSessionId: stored.appSessionId,
      reasoningEffort: 'low',
    });
    const patch = h.history.summaryPatchesAndHidden().patches.get(stored.appSessionId);
    assert.equal(patch?.fastMode, false);
    assert.equal(patch?.reasoningEffort, 'low');
    assert.equal(resumeSettings({ ...stored, ...patch }).fastMode, false);
    await h.create({
      clientRef: 'unsupported-fast',
      sessionPurpose: 'chat',
      title: 'Droid',
      goal: '',
      autonomy: 'low',
      fastMode: true,
    });
    assert.equal(h.runtime.createCalls.length, 0);
    assert.ok(
      h.events.some(
        (event) => event.type === 'error' && /does not support fast mode/.test(event.message),
      ),
    );
  } finally {
    await h.dispose();
  }
});
