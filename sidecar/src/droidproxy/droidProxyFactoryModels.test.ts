import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  existsSync,
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

it('applies and removes proxy models without losing other settings or overwriting backups', () => {
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
  } finally {
    if (previousHome === undefined) delete process.env.HOME;
    else process.env.HOME = previousHome;
    rmSync(home, { recursive: true, force: true });
  }
});

it('leaves Factory settings untouched when customModels has an invalid shape', () => {
  const home = mkdtempSync(join(tmpdir(), 'droidproxy-factory-models-'));
  const previousHome = process.env.HOME;
  process.env.HOME = home;
  try {
    const settingsDir = join(home, '.factory');
    const path = join(settingsDir, 'settings.json');
    mkdirSync(settingsDir);
    const original = '{"customModels":[null]}\n';
    writeFileSync(path, original);

    assert.throws(() => applyDroidProxyFactoryModels(), /customModels must be an array/);
    assert.equal(readFileSync(path, 'utf8'), original);
    assert.equal(readdirSync(settingsDir).length, 1);
    assert.ok(existsSync(path));
  } finally {
    if (previousHome === undefined) delete process.env.HOME;
    else process.env.HOME = previousHome;
    rmSync(home, { recursive: true, force: true });
  }
});
