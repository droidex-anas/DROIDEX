import assert from 'node:assert/strict';
import { rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import test from 'node:test';
import type { ModelInfo } from '../../protocol.js';
import { deferred } from '../../testing/projectServiceHarness.js';
import { fixture } from '../../testing/devinProviderFixture.js';

test('Devin probe answers before scanning and publishes enriched models later', async (t) => {
  const h = await fixture(t);
  const published = deferred<ModelInfo[]>();
  const ready = await h.provider.probe(
    new AbortController().signal,
    () => undefined,
    (models) => {
      published.resolve(models);
    },
  );
  assert.equal(ready.readiness, 'ready');
  assert.equal(
    ready.models
      .find((model) => model.id === 'swe-high')
      ?.supportedReasoningEfforts?.includes('medium') ?? false,
    false,
  );
  const enriched = await published.promise;
  assert.deepEqual(enriched.find((model) => model.id === 'swe-high')?.supportedReasoningEfforts, [
    'medium',
    'high',
    'xhigh',
  ]);
});

test('Devin probe reports auth, models and defaults and deletes its provisional session', async (t) => {
  const h = await fixture(t);
  await rm(h.credentials);
  const signedOut = await h.provider.probe(new AbortController().signal);
  assert.equal(signedOut.readiness, 'unauthenticated');
  assert.match(signedOut.message ?? '', /devin auth login/);
  await writeFile(h.credentials, 'windsurf_api_key = "wrong-key"\n');
  const rejected = await h.provider.probe(new AbortController().signal);
  assert.equal(rejected.readiness, 'unauthenticated');
  assert.match(rejected.message ?? '', /sign in again/);
  await writeFile(h.credentials, 'windsurf_api_key = "test-key"\n');
  const published: { name: string; kind: string; argumentHint?: string }[][] = [];
  const ready = await h.provider.probe(new AbortController().signal, (items) => {
    published.push(
      items.map((item) => ({
        name: item.name,
        kind: item.kind,
        ...(item.argumentHint ? { argumentHint: item.argumentHint } : {}),
      })),
    );
  });
  assert.equal(ready.readiness, 'ready');
  assert.deepEqual(published.at(-1), [
    { name: 'status', kind: 'command' },
    { name: 'review-code', kind: 'skill' },
  ]);
  assert.equal(ready.version, '3000.14.30821');
  assert.equal(ready.defaultModelId, 'swe-fast-medium');
  assert.ok(ready.models.every((model) => model.supportsFastMode === false));
  assert.deepEqual(
    ready.models.map((model) => [
      model.id,
      model.isDefault,
      model.supportedReasoningEfforts,
      model.defaultReasoningEffort,
      model.maxContextTokens,
      model.costTier,
      model.costSummary,
    ]),
    [
      [
        'swe-fast-medium',
        true,
        ['low', 'medium', 'high'],
        'medium',
        200000,
        'Free',
        'Included in every plan',
      ],
      [
        'swe-high',
        false,
        ['medium', 'high', 'xhigh'],
        'high',
        1000000,
        'Premium',
        'Billed at the Premium rate',
      ],
    ],
  );
  assert.ok((await h.requests()).some((request) => request.method === 'session/delete'));
  await writeFile(join(h.cwd, 'empty-models'), '');
  const empty = await h.provider.probe(new AbortController().signal);
  assert.equal(empty.readiness, 'ready');
  assert.deepEqual(empty.models, []);
  assert.equal(empty.defaultModelId, 'swe-fast-medium');
  const aborted = AbortSignal.abort();
  assert.equal((await h.provider.probe(aborted)).readiness, 'error');
  assert.equal((await h.provider.readUsage()).unavailable, 'no_plan_limits');
});
