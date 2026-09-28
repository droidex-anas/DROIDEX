import assert from 'node:assert/strict';
import test from 'node:test';

import { claudeDefaultModel } from './claudeModels.js';

// Shaped like the rows the installed CLI publishes: no row carries the `[1m]`
// suffix in its `value`, and the recommendation names an extended variant.
const catalog = [
  {
    value: 'default',
    resolvedModel: 'claude-opus-5[1m]',
    displayName: 'Default (recommended)',
    description: 'Opus 5 · Best for everyday, complex tasks',
  },
  {
    value: 'claude-opus-5',
    resolvedModel: 'claude-opus-5',
    displayName: 'Opus 5',
    description: '',
  },
  {
    value: 'sonnet',
    resolvedModel: 'claude-sonnet-5[1m]',
    displayName: 'Sonnet 5',
    description: '',
  },
];

test('the default model resolves past its extended-context suffix to a listed row', () => {
  // No configured model: the recommendation names the 1M variant of a row the
  // picker lists, so the picker gets the row and the launch keeps the suffix.
  assert.deepEqual(claudeDefaultModel(catalog, undefined), {
    modelId: 'claude-opus-5',
    launchModelId: 'claude-opus-5[1m]',
    contextWindowTokens: 1000000,
  });
  // A configured wire id resolves through the alias row that covers it.
  assert.deepEqual(claudeDefaultModel(catalog, 'claude-sonnet-5[1m]'), {
    modelId: 'sonnet',
    launchModelId: 'claude-sonnet-5[1m]',
    contextWindowTokens: 1000000,
  });
  // Without the suffix the chat runs on whatever window the CLI chooses.
  assert.deepEqual(claudeDefaultModel(catalog, 'claude-opus-5'), {
    modelId: 'claude-opus-5',
    launchModelId: 'claude-opus-5',
  });
  // An id the catalog does not publish still reaches the CLI unchanged.
  assert.deepEqual(claudeDefaultModel(catalog, 'opus[1m]'), {
    modelId: 'opus[1m]',
    launchModelId: 'opus[1m]',
    contextWindowTokens: 1000000,
  });
  assert.equal(claudeDefaultModel([], undefined), undefined);
});
