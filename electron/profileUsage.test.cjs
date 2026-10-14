const test = require('node:test');
const assert = require('node:assert/strict');
const { createProfileUsage } = require('./profileUsage.cjs');

const snapshot = {
  sync: {
    status: 'ready',
    sources: { jsonl: 'ready', openCode: 'ready', droid: 'ready' },
  },
  lifetimeTokens: 1200,
  peakDayTokens: 500,
  sessions: 3,
  currentStreak: 1,
  longestStreak: 2,
  trackingSince: 1,
  days: [],
  harnesses: [],
  models: [],
  totals: {
    events: 0,
    inputTokens: null,
    outputTokens: null,
    cacheWriteTokens: null,
    cacheReadTokens: null,
    reasoningTokens: null,
    providerCostMicrousd: null,
    estimatedCostMicrousd: null,
    tokensComplete: true,
  },
  coverage: {},
  timeZone: 'UTC',
};

test('profile usage reads only the authenticated local sidecar endpoint', async () => {
  let requested;
  const usage = createProfileUsage({
    bridgeInfo: async () => ({ port: 43123, token: 'local-secret' }),
    fetch: async (url, options) => {
      requested = { url, options };
      return { ok: true, status: 200, text: async () => JSON.stringify(snapshot) };
    },
  });

  assert.deepEqual(await usage.snapshot(), snapshot);
  assert.equal(requested.url, 'http://127.0.0.1:43123/profile/usage');
  assert.equal(requested.options.headers.authorization, 'Bearer local-secret');
  assert.equal(requested.url.includes('local-secret'), false);
});

test('profile usage rejects unavailable, malformed, and oversized local responses', async () => {
  const create = (response) =>
    createProfileUsage({
      bridgeInfo: async () => ({ port: 43123, token: 'secret' }),
      fetch: async () => response,
    });

  await assert.rejects(
    create({ ok: false, status: 503, text: async () => '' }).snapshot(),
    /usage is unavailable/i,
  );
  await assert.rejects(
    create({ ok: true, status: 200, text: async () => '{' }).snapshot(),
    /invalid usage data/i,
  );
  await assert.rejects(
    create({ ok: true, status: 200, text: async () => 'x'.repeat(256 * 1024 + 1) }).snapshot(),
    /safety limit/i,
  );
});
