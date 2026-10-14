import assert from 'node:assert/strict';
import test from 'node:test';

import { readRemoteUsage } from './profileUsage.js';

const snapshot = {
  sync: {
    status: 'ready',
    sources: { jsonl: 'ready', openCode: 'ready', droid: 'ready' },
  },
  lifetimeTokens: 3,
  peakDayTokens: 3,
  sessions: 1,
  currentStreak: 1,
  longestStreak: 1,
  trackingSince: 1,
  days: [{ date: '2026-10-14', tokens: 3, events: 1, complete: true }],
  harnesses: [{ name: 'Codex', sessions: 1, events: 1, tokens: 3, complete: true }],
  models: [{ name: 'gpt-6', sessions: 1, events: 1, tokens: 3, complete: true }],
  totals: {
    events: 1,
    inputTokens: 2,
    outputTokens: 1,
    cacheWriteTokens: null,
    cacheReadTokens: null,
    reasoningTokens: null,
    providerCostMicrousd: null,
    estimatedCostMicrousd: null,
    tokensComplete: true,
  },
  coverage: { inputTokens: { known: 1, events: 1 } },
  timeZone: 'UTC',
};

test('remote usage authenticates locally and strips private fields before encryption', async () => {
  let request: { url: string; authorization: string | null } | undefined;
  const result = await readRemoteUsage(
    async () => ({ port: 43123, token: 'bridge-secret' }),
    async (input, init) => {
      const headers = new Headers(init?.headers);
      request = { url: String(input), authorization: headers.get('authorization') };
      return new Response(JSON.stringify({ ...snapshot, sourcePath: '/private/log.jsonl' }));
    },
  );
  assert.deepEqual(result, snapshot);
  assert.deepEqual(request, {
    url: 'http://127.0.0.1:43123/profile/usage',
    authorization: 'Bearer bridge-secret',
  });
  assert.equal(JSON.stringify(result).includes('private'), false);
});
