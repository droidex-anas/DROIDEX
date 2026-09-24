import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { droidProxySettingsModels, mergeFactoryModels } from './droidProxyFactoryModels.js';

describe('droidProxySettingsModels', () => {
  it('emits one entry per catalog definition for enabled providers', () => {
    const models = droidProxySettingsModels(() => true);
    const ids = new Set(models.map((model) => model.id));
    assert.equal(ids.size, models.length);
    assert.ok(models.length > 10);
    for (const model of models) {
      assert.ok(model.id.startsWith('custom:droidproxy:'));
      assert.ok(model.baseUrl.startsWith('http://localhost:8317'));
      assert.equal(model.apiKey, 'dummy-not-used');
      assert.ok(model.displayName.startsWith('DroidProxy: '));
      assert.equal(model.enableThinking, true);
      assert.ok(model.supportedReasoningEfforts.length > 0);
    }
  });

  it('omits disabled providers and swaps the Muse variant by contributor mode', () => {
    const models = droidProxySettingsModels((key) => key !== 'codex', {
      contributorMode: true,
    });
    assert.ok(models.every((model) => !model.id.includes('gpt-6')));
    assert.ok(models.some((model) => model.id === 'custom:droidproxy:muse-spark-1.3-contributor'));
    assert.ok(!models.some((model) => model.id === 'custom:droidproxy:muse-spark-1.3'));

    const base = droidProxySettingsModels(() => true, { contributorMode: false });
    assert.ok(base.some((model) => model.id === 'custom:droidproxy:muse-spark-1.3'));
    assert.ok(!base.some((model) => model.id === 'custom:droidproxy:muse-spark-1.3-contributor'));
  });
});

describe('mergeFactoryModels', () => {
  it('replaces only DroidProxy entries and re-indexes sequentially', () => {
    const other = { id: 'custom:other:model', index: 11 };
    const stale = { id: 'custom:droidproxy:grok-4.5', index: 1 };
    const current = { id: 'custom:droidproxy:gpt-6-sol', index: 2 };
    const enabled = droidProxySettingsModels((key) => key === 'codex', {
      contributorMode: false,
    });

    const { merged, removed } = mergeFactoryModels([other, stale, current], enabled);

    assert.equal(removed, 2);
    assert.equal(merged[0].id, 'custom:other:model');
    const ids = merged.map((item) => item.id);
    assert.ok(!ids.includes('custom:droidproxy:grok-4.5'));
    assert.ok(ids.includes('custom:droidproxy:gpt-6-sol'));
    assert.deepEqual(
      merged.map((item) => item.index),
      merged.map((_, index) => index),
    );
  });
});
