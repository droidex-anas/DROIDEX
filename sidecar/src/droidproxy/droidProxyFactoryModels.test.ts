import test from 'node:test';
import assert from 'node:assert/strict';
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  applyDroidProxyFactoryModels,
  droidProxySettingsModels,
  mergeFactoryModels,
} from './droidProxyFactoryModels.js';

test('settings emit one proxy entry per enabled definition, with the Muse variant set by contributor mode', () => {
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

  const contributor = droidProxySettingsModels((key) => key !== 'codex', {
    contributorMode: true,
  });
  assert.ok(contributor.every((model) => !model.id.includes('gpt-6')));
  assert.ok(
    contributor.some((model) => model.id === 'custom:droidproxy:muse-spark-1.3-contributor'),
  );
  assert.ok(!contributor.some((model) => model.id === 'custom:droidproxy:muse-spark-1.3'));

  const base = droidProxySettingsModels(() => true, { contributorMode: false });
  assert.ok(base.some((model) => model.id === 'custom:droidproxy:muse-spark-1.3'));
  assert.ok(!base.some((model) => model.id === 'custom:droidproxy:muse-spark-1.3-contributor'));
});

test('merging replaces only proxy entries; applying keeps other settings and refuses an invalid shape untouched', () => {
  const enabled = droidProxySettingsModels((key) => key === 'codex', { contributorMode: false });
  const { merged, removed } = mergeFactoryModels(
    [
      { id: 'custom:other:model', index: 11 },
      { id: 'custom:droidproxy:grok-4.5', index: 1 },
      { id: 'custom:droidproxy:gpt-6-sol', index: 2 },
    ],
    enabled,
  );
  assert.equal(removed, 2);
  assert.equal(merged[0].id, 'custom:other:model');
  const ids = merged.map((item) => item.id);
  assert.ok(!ids.includes('custom:droidproxy:grok-4.5'));
  assert.ok(ids.includes('custom:droidproxy:gpt-6-sol'));
  assert.deepEqual(
    merged.map((item) => item.index),
    merged.map((_, index) => index),
  );

  const home = mkdtempSync(join(tmpdir(), 'droidproxy-factory-models-'));
  const previousHome = process.env.HOME;
  process.env.HOME = home;
  try {
    const settingsDir = join(home, '.factory');
    const path = join(settingsDir, 'settings.json');
    mkdirSync(settingsDir);
    const original = `${JSON.stringify({
      customModels: [{ id: 'custom:other:model', index: 9 }],
      otherSetting: 'keep',
    })}\n`;
    writeFileSync(path, original, { mode: 0o600 });

    const first = applyDroidProxyFactoryModels((provider) => provider === 'codex');
    assert.ok(first.applied > 0);
    assert.ok(first.backupPath);
    assert.equal(readFileSync(first.backupPath, 'utf8'), original);
    assert.equal(statSync(path).mode & 0o777, 0o600);

    const second = applyDroidProxyFactoryModels(() => false);
    assert.equal(second.applied, 0);
    assert.ok(second.removed > 0);
    assert.ok(second.backupPath);
    assert.notEqual(second.backupPath, first.backupPath);
    assert.equal(readFileSync(first.backupPath, 'utf8'), original);
    assert.deepEqual(JSON.parse(readFileSync(path, 'utf8')), {
      customModels: [{ id: 'custom:other:model', index: 0 }],
      otherSetting: 'keep',
    });
    assert.equal(
      readdirSync(settingsDir).some((name) => name.endsWith('.tmp')),
      false,
    );

    const invalid = '{"customModels":[null]}\n';
    writeFileSync(path, invalid);
    const entries = readdirSync(settingsDir).length;
    assert.throws(() => applyDroidProxyFactoryModels(), /customModels must be an array/);
    assert.equal(readFileSync(path, 'utf8'), invalid);
    assert.equal(readdirSync(settingsDir).length, entries);
  } finally {
    if (previousHome === undefined) delete process.env.HOME;
    else process.env.HOME = previousHome;
    rmSync(home, { recursive: true, force: true });
  }
});
