import assert from 'node:assert/strict';
import test from 'node:test';

import { createIdentity, profileShareProof, signIdentity } from '../../../packages/remote/src';
import {
  createPublicProfileSnapshot,
  decodePublishedProfile,
  encodeProfilePayload,
  verifyPublishedProfile,
  type ProfileUsageSnapshot,
  type PublishedProfile,
  type PublicProfileSnapshot,
} from './profileShare';

const usage: ProfileUsageSnapshot = {
  sync: {
    status: 'ready',
    sources: { jsonl: 'ready', openCode: 'ready', droid: 'ready' },
  },
  lifetimeTokens: 1200,
  peakDayTokens: 200,
  sessions: 3,
  currentStreak: 1,
  longestStreak: 2,
  trackingSince: 1,
  days: [{ date: '2026-10-14', tokens: 200, events: 1, complete: true }],
  harnesses: [{ name: 'Codex', sessions: 3, events: 3, tokens: 1200, complete: true }],
  models: [{ name: 'gpt-6', sessions: 3, events: 3, tokens: 1200, complete: true }],
  totals: {
    events: 3,
    inputTokens: 800,
    outputTokens: 400,
    cacheWriteTokens: 0,
    cacheReadTokens: 300,
    reasoningTokens: 100,
    providerCostMicrousd: 500,
    estimatedCostMicrousd: 600,
    tokensComplete: true,
  },
  coverage: { inputTokens: { known: 3, events: 3 } },
  timeZone: 'Asia/Kolkata',
};

const profile = createPublicProfileSnapshot({ displayName: 'Anas', username: 'anas' }, usage, 2);

async function publish(payload: string): Promise<PublishedProfile> {
  const identity = await createIdentity();
  return {
    payload,
    publicKey: identity.publicKey,
    signature: await signIdentity(
      identity.privateKey,
      profileShareProof(profile.username, payload),
    ),
  };
}

test('sharing keeps only rendered public fields in a verified published bundle', async () => {
  const withPrivateFields = {
    ...usage,
    sourcePath: '/private/log.jsonl',
    days: [{ ...usage.days[0], apiKey: 'private-key' }],
    models: [{ ...usage.models[0], filePath: '/private/workspace' }],
  };
  const snapshot = createPublicProfileSnapshot(
    { displayName: 'Anas', username: 'anas' },
    withPrivateFields,
    2,
  );
  const payload = encodeProfilePayload(snapshot);
  const decoded = await verifyPublishedProfile(await publish(payload), profile.username);

  assert.deepEqual(decoded?.profile, profile);
  const serialized = JSON.stringify(decoded?.profile);
  for (const privateValue of ['private', 'Asia/Kolkata', 'providerCost', 'cacheRead', 'coverage']) {
    assert.equal(serialized.includes(privateValue), false);
  }
});

test('published bundles reject malformed data, wrong usernames and altered payloads', async () => {
  const payload = encodeProfilePayload(profile);
  const published = await publish(payload);

  assert.equal(decodePublishedProfile(null), null);
  assert.equal(decodePublishedProfile({ ...published, payload: 'a'.repeat(20 * 1024 + 1) }), null);
  assert.equal(decodePublishedProfile(published, 'someone-else'), null);
  assert.throws(() =>
    encodeProfilePayload({ ...profile, lifetimeTokens: -1 } as PublicProfileSnapshot),
  );
  assert.throws(() =>
    encodeProfilePayload({ ...profile, displayName: '   ' } as PublicProfileSnapshot),
  );
  assert.throws(() =>
    encodeProfilePayload({
      ...profile,
      generatedDay: undefined,
    } as unknown as PublicProfileSnapshot),
  );
  assert.throws(() =>
    encodeProfilePayload({
      ...profile,
      days: [{ date: '2026-02-31', tokens: 1, complete: true }],
    } as PublicProfileSnapshot),
  );

  const changed = encodeProfilePayload({ ...profile, lifetimeTokens: 9_999 });
  assert.equal(await verifyPublishedProfile({ ...published, payload: changed }), null);
});

test('sharing refuses a partial or failed local index', () => {
  assert.throws(
    () =>
      createPublicProfileSnapshot(
        { displayName: 'Anas', username: 'anas' },
        {
          ...usage,
          sync: {
            status: 'indexing',
            sources: { jsonl: 'ready', openCode: 'indexing', droid: 'ready' },
          },
        },
      ),
    /still indexing/i,
  );
  assert.throws(
    () =>
      createPublicProfileSnapshot(
        { displayName: 'Anas', username: 'anas' },
        {
          ...usage,
          sync: {
            status: 'error',
            sources: { jsonl: 'ready', openCode: 'error', droid: 'ready' },
          },
        },
      ),
    /needs attention/i,
  );
});

test('sharing preserves token availability and incomplete coverage', () => {
  const partial = createPublicProfileSnapshot(
    { displayName: 'Anas', username: 'anas' },
    {
      ...usage,
      totals: { ...usage.totals, tokensComplete: false },
      days: [{ ...usage.days[0], complete: false }],
    },
    2,
  );
  assert.equal(partial.tokensReported, true);
  assert.equal(partial.tokensComplete, false);
  assert.equal(partial.days[0]?.complete, false);
  assert.equal(partial.lifetimeTokens, usage.lifetimeTokens);

  const unreported = createPublicProfileSnapshot(
    { displayName: 'Anas', username: 'anas' },
    {
      ...usage,
      lifetimeTokens: 0,
      peakDayTokens: 0,
      totals: {
        ...usage.totals,
        inputTokens: null,
        outputTokens: null,
        tokensComplete: false,
      },
    },
    2,
  );
  assert.equal(unreported.tokensReported, false);
});

test('sharing anchors activity to the owner-local generated day', async () => {
  const generatedAt = Date.UTC(2026, 9, 14, 20, 0);
  const snapshot = createPublicProfileSnapshot(
    { displayName: 'Anas', username: 'anas' },
    usage,
    generatedAt,
  );

  assert.equal(snapshot.generatedDay, '2026-10-15');
  assert.equal(
    decodePublishedProfile(await publish(encodeProfilePayload(snapshot)))?.profile.generatedDay,
    '2026-10-15',
  );
  assert.throws(() =>
    encodeProfilePayload({ ...snapshot, generatedDay: '2026-02-31' } as PublicProfileSnapshot),
  );
});

test('a full year of public activity stays inside the bounded published payload', async () => {
  const days = Array.from({ length: 366 }, (_, index) => ({
    date: new Date(Date.UTC(2025, 0, index + 1)).toISOString().slice(0, 10),
    tokens: 1_000_000 + index,
    complete: true,
  }));
  const snapshot = { ...profile, days };
  const payload = encodeProfilePayload(snapshot);
  assert.ok(payload.length < 20 * 1024);
  assert.deepEqual((await verifyPublishedProfile(await publish(payload)))?.profile.days, days);
});
