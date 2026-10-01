import assert from 'node:assert/strict';
import test from 'node:test';

import type { ModelInfo } from '@anthropic-ai/claude-agent-sdk';

import { claudeContextModel } from './claudeContextWindow.js';
import { claudeDefaultModel, claudeLaunchModel, claudeModelRows } from './claudeModels.js';

// Shaped like the rows the installed CLI publishes: no row carries the `[1m]`
// suffix in its `value`, and the recommendation names an extended variant.
const catalog: ModelInfo[] = [
  {
    value: 'default',
    resolvedModel: 'claude-opus-5[1m]',
    displayName: 'Default (recommended)',
    description: 'Opus 5 · Best for everyday, complex tasks',
  },
  {
    value: 'claude-opus-5-5',
    resolvedModel: 'claude-opus-5-5',
    displayName: 'Opus 5.5',
    description: 'Best for everyday, complex tasks',
    supportedEffortLevels: ['low', 'high', 'xhigh'],
    supportsFastMode: true,
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
  { value: 'haiku', resolvedModel: 'claude-haiku-4-5', displayName: 'Haiku 4.5', description: '' },
];

test('the default model resolves past its extended-context suffix to a listed row', () => {
  assert.deepEqual(claudeDefaultModel(catalog, undefined), {
    modelId: 'claude-opus-5',
    launchModelId: 'claude-opus-5[1m]',
    contextWindowTokens: 1000000,
  });
  assert.deepEqual(claudeDefaultModel(catalog, 'claude-sonnet-5[1m]'), {
    modelId: 'sonnet',
    launchModelId: 'claude-sonnet-5[1m]',
    contextWindowTokens: 1000000,
  });
  assert.deepEqual(claudeDefaultModel(catalog, 'claude-opus-5'), {
    modelId: 'claude-opus-5',
    launchModelId: 'claude-opus-5',
  });
  assert.equal(claudeDefaultModel([], undefined), undefined);
});

test('a default that names a family alias is published as its own entry', () => {
  const [entry, ...rest] = claudeModelRows(
    catalog,
    undefined,
    claudeDefaultModel(catalog, 'opus[1m]'),
  );
  assert.deepEqual(claudeDefaultModel(catalog, 'opus[1m]')?.modelId, 'opus[1m]');
  assert.deepEqual(entry, {
    id: 'opus[1m]',
    // Never a version: the app does not know which Opus the alias resolves to.
    displayName: 'Opus',
    provider: 'anthropic',
    isCustom: false,
    maxContextTokens: 1000000,
    supportsFastMode: true,
    supportedReasoningEfforts: ['low', 'high', 'xhigh', 'ultra'],
    defaultReasoningEffort: 'high',
  });
  assert.deepEqual(
    rest.map((row) => row.id),
    ['claude-opus-5-5', 'claude-opus-5', 'sonnet', 'haiku'],
  );
  const [plain] = claudeModelRows(catalog, undefined, claudeDefaultModel(catalog, 'opus'));
  assert.equal(plain?.maxContextTokens, 200000);
  assert.throws(() => claudeContextModel('opus', 1000000, catalog), /no 1M context window/);
  assert.equal(claudeDefaultModel(catalog, 'my-proxy-model')?.modelId, 'my-proxy-model');
  assert.equal(claudeModelRows(catalog, undefined, claudeDefaultModel(catalog, 'x')).length, 4);
});

test('the window a row offers is the window the launch accepts', () => {
  const ceilings = new Map(
    claudeModelRows(catalog, undefined, undefined).map((row) => [row.id, row.maxContextTokens]),
  );
  assert.deepEqual(
    [...ceilings],
    [
      ['claude-opus-5-5', 200000],
      ['claude-opus-5', 1000000],
      ['sonnet', 1000000],
      ['haiku', 200000],
    ],
  );
  for (const [id, ceiling] of ceilings) {
    assert.equal(claudeContextModel(id, 200000, catalog), id);
    if (ceiling === 1000000) assert.ok(claudeContextModel(id, 1000000, catalog));
    else assert.throws(() => claudeContextModel(id, 1000000, catalog), /no 1M context window/);
  }
  assert.equal(claudeContextModel('claude-opus-5', 1000000, catalog), 'claude-opus-5[1m]');
  assert.equal(claudeContextModel('sonnet', 1000000, catalog), 'claude-sonnet-5[1m]');
  assert.equal(claudeContextModel('opus[1m]', 1000000, catalog), 'opus[1m]');
  assert.equal(claudeContextModel('opus[1m]', 200000, catalog), 'opus');
});

test('a chat on the default model that pins no window launches what the CLI default would', () => {
  const defaultModel = claudeDefaultModel(catalog, undefined);
  assert.equal(claudeLaunchModel(undefined, undefined, catalog, defaultModel), 'claude-opus-5[1m]');
  assert.equal(
    claudeLaunchModel('claude-opus-5', undefined, catalog, defaultModel),
    'claude-opus-5[1m]',
  );
  assert.equal(claudeLaunchModel('claude-opus-5', 200000, catalog, defaultModel), 'claude-opus-5');
  assert.equal(claudeLaunchModel('haiku', undefined, catalog, defaultModel), 'haiku');
});
