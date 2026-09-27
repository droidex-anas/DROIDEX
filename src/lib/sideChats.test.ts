import assert from 'node:assert/strict';
import test from 'node:test';
import type { HarnessModels } from '../hooks/persistedUiPreferences';
import type { SessionSummary } from '../types/bridge';
import { sideChatPromptFromCommand, sideChatSettings } from './sideChats';

test('/side and /btw open a side chat, with any words after them as its question', () => {
  assert.equal(sideChatPromptFromCommand('/side'), '');
  assert.equal(sideChatPromptFromCommand('  /BTW  '), '');
  assert.equal(sideChatPromptFromCommand('/btw why is\nthis slow? '), 'why is\nthis slow?');
  assert.equal(sideChatPromptFromCommand('/side-effects'), null);
  assert.equal(sideChatPromptFromCommand('/sidebar'), null);
  assert.equal(sideChatPromptFromCommand('ask /btw later'), null);
});

const source: SessionSummary = {
  appSessionId: 'source',
  provider: 'claude',
  modelId: 'claude-opus',
  reasoningEffort: 'high',
  sessionPurpose: 'chat',
  interactionMode: 'auto',
  role: 'primary',
  title: 'Source',
  goal: 'Source',
  autonomy: 'low',
  phase: 'paused',
  features: [],
  tokensIn: 0,
  tokensOut: 0,
  contextTokens: 0,
  createdAt: 1,
  updatedAt: 1,
};

const harnessModels: HarnessModels = {
  droid: { modelId: 'droid-default', reasoning: 'low' },
  claude: { modelId: 'claude-default', reasoning: 'medium' },
  codex: { modelId: 'gpt-default', reasoning: 'medium' },
};

test('a side chat runs on its source harness and model unless another is picked', () => {
  assert.deepEqual(sideChatSettings(source, undefined, harnessModels), {
    provider: 'claude',
    modelId: 'claude-opus',
    reasoningEffort: 'high',
  });
  // Another harness cannot run the source's model, so it starts on its own default.
  assert.deepEqual(sideChatSettings(source, { provider: 'codex' }, harnessModels), {
    provider: 'codex',
    modelId: 'gpt-default',
    reasoningEffort: 'medium',
  });
  const picked = { provider: 'codex' as const, modelId: 'gpt-mini' };
  assert.deepEqual(sideChatSettings(source, picked, harnessModels), picked);
});
