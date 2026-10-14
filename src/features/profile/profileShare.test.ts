import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createIdentity,
  profileShareProof,
  signIdentity,
  verifyIdentity,
} from '../../../packages/remote/src';
import {
  createPublicProfileSnapshot,
  decodeProfileShare,
  encodeProfilePayload,
  encodeProfileShare,
  type ProfileAttestation,
  type ProfileUsageSnapshot,
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

async function attest(payload: string): Promise<ProfileAttestation> {
  const identity = await createIdentity();
  return {
    username: profile.username,
    publicKey: identity.publicKey,
    signature: await signIdentity(
      identity.privateKey,
      profileShareProof(profile.username, payload),
    ),
  };
}

test('sharing keeps only rendered public fields and binds them to a laptop signature', async () => {
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
  const attestation = await attest(payload);
  const fragment = encodeProfileShare(payload, attestation);
  const decoded = decodeProfileShare(`#${fragment}`);
  assert.deepEqual(decoded?.profile, profile);
  const serialized = JSON.stringify(decoded?.profile);
  for (const privateValue of ['private', 'Asia/Kolkata', 'providerCost', 'cacheRead', 'coverage']) {
    assert.equal(serialized.includes(privateValue), false);
  }
  assert.equal(
    await verifyIdentity(
      decoded?.publicKey ?? {},
      profileShareProof(profile.username, payload),
      decoded?.signature ?? '',
    ),
    true,
  );
});

test('untrusted fragments reject malformed public data and altered signed payloads', async () => {
  const payload = encodeProfilePayload(profile);
  const attestation = await attest(payload);
  assert.equal(decodeProfileShare('a'.repeat(24 * 1024 + 1)), null);
  assert.equal(decodeProfileShare('%%%'), null);
  assert.throws(() =>
    encodeProfilePayload({ ...profile, lifetimeTokens: -1 } as PublicProfileSnapshot),
  );
  assert.throws(() =>
    encodeProfilePayload({ ...profile, displayName: '   ' } as PublicProfileSnapshot),
  );
  assert.throws(() =>
    encodeProfilePayload({
      ...profile,
      days: [{ date: '2026-02-31', tokens: 1 }],
    } as PublicProfileSnapshot),
  );

  const changed = encodeProfilePayload({ ...profile, lifetimeTokens: 9_999 });
  const forged = decodeProfileShare(encodeProfileShare(changed, attestation));
  assert.equal(
    await verifyIdentity(
      forged?.publicKey ?? {},
      profileShareProof(profile.username, changed),
      forged?.signature ?? '',
    ).catch(() => false),
    false,
  );
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

test('sharing preserves incomplete token coverage as measured minimums', async () => {
  const snapshot = createPublicProfileSnapshot(
    { displayName: 'Anas', username: 'anas' },
    {
      ...usage,
      totals: { ...usage.totals, tokensComplete: false },
      days: [{ ...usage.days[0], complete: false }],
    },
    2,
  );
  const payload = encodeProfilePayload(snapshot);
  const decoded = decodeProfileShare(encodeProfileShare(payload, await attest(payload)));

  assert.equal(decoded?.profile.tokensComplete, false);
  assert.equal(decoded?.profile.days[0]?.complete, false);
  assert.equal(decoded?.profile.lifetimeTokens, usage.lifetimeTokens);
});

test('a full year of public activity stays inside the bounded signed link', async () => {
  const days = Array.from({ length: 366 }, (_, index) => ({
    date: new Date(Date.UTC(2025, 0, index + 1)).toISOString().slice(0, 10),
    tokens: 1_000_000 + index,
    complete: true,
  }));
  const snapshot = { ...profile, days };
  const payload = encodeProfilePayload(snapshot);
  const fragment = encodeProfileShare(payload, await attest(payload));
  assert.ok(fragment.length < 24 * 1024);
  assert.deepEqual(decodeProfileShare(fragment)?.profile.days, days);
});
