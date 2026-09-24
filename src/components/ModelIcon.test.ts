import test from 'node:test';
import assert from 'node:assert/strict';
import { providerOf } from './ModelIcon';
import type { ModelInfo } from '../types/bridge';

function custom(id: string, displayName: string, provider = 'openai'): ModelInfo {
  return { id, displayName, provider, isCustom: true };
}

test('model identity decides before the generic provider field', () => {
  assert.equal(
    providerOf(
      custom(
        'custom:droidproxy:muse-spark-1.3-contributor',
        'DroidProxy: Meta: Muse Spark 1.3 Contributor',
      ),
    ),
    'meta',
  );
  assert.equal(providerOf(custom('custom:droidproxy:grok-4.7', 'DroidProxy: Grok 4.7')), 'xai');
  assert.equal(providerOf(custom('custom:droidproxy:kimi-k3', 'DroidProxy: Kimi K3')), 'kimi');
  assert.equal(
    providerOf(custom('custom:droidproxy:gpt-6-sol', 'DroidProxy: GPT 6 Sol')),
    'openai',
  );
  assert.equal(
    providerOf(
      custom(
        'custom:droidproxy:antigravity-gemini-3.1-pro',
        'DroidProxy: Antigravity: Gemini 3.1 Pro (High)',
      ),
    ),
    'google',
  );
});

test('an unrecognized custom model never borrows the OpenAI mark', () => {
  assert.equal(providerOf(custom('custom:acme:command-r', 'Command R')), 'default');
  assert.equal(providerOf(custom('custom:acme:phi-4', 'Phi 4', 'anthropic')), 'default');
});

test('makers win over subscription wrappers, with word-boundary tokens', () => {
  assert.equal(
    providerOf(
      custom('custom:droidproxy:copilot-claude-opus-4-8', 'DroidProxy: GitHub Copilot: Opus 4.8'),
    ),
    'anthropic',
  );
  assert.equal(providerOf(custom('custom:acme:copilot-gpt-4o', 'Copilot GPT 4o')), 'openai');
  assert.equal(providerOf(custom('custom:acme:plain-copilot', 'Plain Copilot Model')), 'copilot');
  // Substring lookalikes stay unrecognized: amused is not Muse, a GitHub
  // path prefix is not Copilot.
  assert.equal(providerOf(custom('custom:acme:amused-1', 'Amused 1')), 'default');
  assert.equal(providerOf(custom('github/gpt-4o', 'github/gpt-4o')), 'openai');
});

test('built-in models still resolve from the provider field', () => {
  assert.equal(
    providerOf({ id: 'gpt-4o', displayName: 'GPT 4o', provider: 'openai', isCustom: false }),
    'openai',
  );
  assert.equal(
    providerOf({
      id: 'claude-opus-4-8',
      displayName: 'Opus',
      provider: 'anthropic',
      isCustom: false,
    }),
    'anthropic',
  );
  assert.equal(providerOf(undefined, undefined), 'default');
});
