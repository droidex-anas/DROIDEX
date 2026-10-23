import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import {
  decodeProfilePayload,
  encodeProfilePayload,
  parsePublicProfileSnapshot,
} from '../../../packages/remote/src/profile.js';
import { remoteUsageSnapshot } from '../../../packages/remote/src/usage.js';
import { UsageDatabase } from './UsageDatabase.js';
import type { UsageEvent } from './types.js';

test('one bounded usage breakdown supplies the transport and privacy-safe public subset', (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'droidex-usage-snapshot-'));
  const now = Date.parse('2026-01-01T12:00:00Z');
  const database = new UsageDatabase({
    databasePath: join(directory, 'usage.sqlite'),
    timeZone: 'UTC',
    now: () => now,
  });
  t.after(() => {
    database.close();
    rmSync(directory, { recursive: true, force: true });
  });
  const events: UsageEvent[] = Array.from({ length: 6 }, (_, index) => ({
    dedupeKey: `private-request-${String(index)}`,
    harnessId: 'opencode',
    harnessDisplayName: 'OpenCode',
    sourceId: 'private-source',
    sessionId: `private-session-${String(index)}`,
    project: '/private/workspace',
    sessionStartedAtMs: now,
    tsMs: now,
    model: `model-${String(index)}`,
    serviceTier: null,
    inputTokens: 100,
    outputTokens: 50,
    cacheWriteTokens: 0,
    cacheReadTokens: 0,
    reasoningTokens: 0,
    providerCostMicrousd: 10,
    estimatedCostMicrousd: null,
    pricingVersion: null,
  }));
  database.ingestUsageSource({
    expectedCursor: null,
    nextCursor: {
      sourcePath: '/private/log.sqlite',
      sourceId: 'private-source',
      adapterName: 'opencode-sqlite',
      adapterVersion: 1,
      state: '{}',
    },
    reset: false,
    events,
  });
  database.recordDroidexSessions(Array.from({ length: 10 }, (_, index) => `app-${String(index)}`));
  const raw = {
    ...database.snapshot(),
    sync: { status: 'ready', sources: { jsonl: 'ready', openCode: 'ready', droid: 'ready' } },
    sourcePath: '/private/log.sqlite',
  };
  const snapshot = remoteUsageSnapshot(raw);
  assert.equal(Object.hasOwn(snapshot, 'analytics'), false);
  assert.equal(JSON.stringify(snapshot).includes('private'), false);
  assert.equal(snapshot.models.length, 6, 'local model breakdown is not a top-five ranking');
  assert.equal(snapshot.mostUsedHarness, 'opencode');
  assert.equal(snapshot.sessions, 10);
  assert.equal(snapshot.harnesses.length, 1);
  assert.deepEqual(snapshot.harnesses[0], {
    id: 'opencode',
    name: 'OpenCode',
    sessions: 6,
    turns: 6,
    events: 6,
    tokens: 900,
    tokensComplete: true,
    costMicrousd: 60,
    costComplete: true,
  });
  assert.deepEqual(snapshot.days, [
    {
      date: '2026-01-01',
      events: 6,
      tokens: 900,
      tokensComplete: true,
      costMicrousd: 60,
      costComplete: true,
    },
  ]);
  for (const invalid of [
    { ...raw, mostUsedHarness: 'missing' },
    { ...raw, days: [{ ...raw.days[0], costComplete: undefined }] },
    { ...raw, harnesses: [{ ...raw.harnesses[0], turns: undefined }] },
    { ...raw, models: Array.from({ length: 257 }, () => raw.models[0]) },
  ])
    assert.throws(() => remoteUsageSnapshot(invalid), /Invalid usage snapshot/);

  const published = parsePublicProfileSnapshot({
    version: 3,
    displayName: 'Engineer',
    username: 'engineer',
    generatedAt: now,
    generatedDay: '2026-01-01',
    trackingDay: '2026-01-01',
    lifetimeTokens: snapshot.lifetimeTokens,
    tokensReported: true,
    tokensComplete: snapshot.totals.tokensComplete,
    peakDayTokens: snapshot.peakDayTokens,
    sessions: snapshot.sessions,
    currentStreak: snapshot.currentStreak,
    longestStreak: snapshot.longestStreak,
    days: snapshot.days,
    harnesses: snapshot.harnesses.slice(0, 5),
    models: snapshot.models.slice(0, 5),
  });
  assert.ok(published);
  assert.deepEqual(published.days, [{ date: '2026-01-01', tokens: 900, tokensComplete: true }]);
  assert.deepEqual(published.harnesses, [{ name: 'OpenCode', sessions: 6 }]);
  assert.deepEqual(decodeProfilePayload(encodeProfilePayload(published)), published);
});
