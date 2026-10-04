import assert from 'node:assert/strict';
import test from 'node:test';
import type { HarnessModels } from '../hooks/persistedUiPreferences';
import {
  promptWithSideChatReplies,
  sideChatPromptFromCommand,
  sideChatSettings,
} from './sideChats';
import { sessionSummary } from '../test/sessionSummary';

test('/side and /btw open a side chat, with any words after them as its question', () => {
  assert.equal(sideChatPromptFromCommand('/side'), '');
  assert.equal(sideChatPromptFromCommand('  /BTW  '), '');
  assert.equal(sideChatPromptFromCommand('/btw why is\nthis slow? '), 'why is\nthis slow?');
  assert.equal(sideChatPromptFromCommand('/side-effects'), null);
  assert.equal(sideChatPromptFromCommand('/sidebar'), null);
  assert.equal(sideChatPromptFromCommand('ask /btw later'), null);
});

const source = sessionSummary('source', {
  provider: 'claude',
  modelId: 'claude-opus',
  reasoningEffort: 'high',
  title: 'Source',
  goal: 'Source',
});

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

test('side-chat answers ride after the prompt in a block the sidecar strips on replay', () => {
  assert.equal(promptWithSideChatReplies('Use this', []), 'Use this');
  assert.equal(
    promptWithSideChatReplies('Use this', ['Sort by date first.']),
    [
      'Use this',
      '',
      '<side_chat_replies>',
      'The user attached these answers from a side chat about this conversation.',
      '<reply>',
      'Sort by date first.',
      '</reply>',
      '</side_chat_replies>',
    ].join('\n'),
  );
});
