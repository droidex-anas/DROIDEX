import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createIdentity,
  encodeProfilePayload,
  MAX_PROFILE_PAYLOAD_LENGTH,
  profileShareProof,
  signIdentity,
  type PublicProfileSnapshot,
} from '../packages/remote/src';
import { loadPublishedProfile } from '../remote-web/src/profileVerification';

const profile = {
  version: 3,
  displayName: 'Anas',
  username: 'anas',
  generatedAt: 2,
  generatedDay: '1970-01-01',
  lifetimeTokens: 1_200,
  tokensReported: true,
  tokensComplete: true,
  peakDayTokens: 200,
  sessions: 3,
  currentStreak: 1,
  longestStreak: 2,
  trackingDay: '1970-01-01',
  days: [{ date: '2026-10-14', tokens: 200, tokensComplete: true }],
  harnesses: [{ name: 'Codex', sessions: 3 }],
  models: [{ name: 'gpt-6', sessions: 3 }],
} satisfies PublicProfileSnapshot;

test('loads and verifies a published profile without browser caching', async () => {
  const identity = await createIdentity();
  const payload = encodeProfilePayload(profile);
  const signature = await signIdentity(
    identity.privateKey,
    profileShareProof(profile.username, payload),
  );
  const controller = new AbortController();
  let request: { url: URL; init: RequestInit } | undefined;

  const result = await loadPublishedProfile(profile.username, controller.signal, {
    relayUrl: 'wss://relay.example/ignored?query=yes#fragment',
    request: async (url, init) => {
      request = { url, init };
      return Response.json({ payload, publicKey: identity.publicKey, signature });
    },
  });

  assert.equal(result.status, 'verified');
  if (result.status === 'verified') assert.deepEqual(result.profile, profile);
  assert.equal(request?.url.href, 'https://relay.example/v1/handles/anas/profile');
  assert.equal(request?.init.method, 'GET');
  assert.equal(request?.init.cache, 'no-store');
  assert.equal(request?.init.signal, controller.signal);
});

test('separates unpublished, unavailable and unverified profiles', async () => {
  const signal = new AbortController().signal;
  let defaultUrl = '';
  const unpublished = await loadPublishedProfile('anas', signal, {
    relayUrl: '',
    request: async (url) => {
      defaultUrl = url.href;
      return new Response(null, { status: 404 });
    },
  });
  const unavailable = await loadPublishedProfile('anas', signal, {
    relayUrl: 'https://relay.example',
    request: async () => new Response(null, { status: 429 }),
  });
  const unverified = await loadPublishedProfile('anas', signal, {
    relayUrl: 'https://relay.example',
    request: async () => Response.json({ payload: 'altered' }),
  });
  const oversized = await loadPublishedProfile('anas', signal, {
    relayUrl: 'https://relay.example',
    request: async () =>
      new Response('{}', {
        headers: { 'content-length': String(MAX_PROFILE_PAYLOAD_LENGTH + 4097) },
      }),
  });

  assert.equal(unpublished.status, 'not-published');
  assert.equal(
    defaultUrl,
    'https://droidex-relay.mdanas7869292.workers.dev/v1/handles/anas/profile',
  );
  assert.equal(unavailable.status, 'unavailable');
  assert.equal(unverified.status, 'unverified');
  assert.equal(oversized.status, 'unverified');
});

test('rejects an invalid public username before making a request', async () => {
  let requested = false;
  const result = await loadPublishedProfile('Not Valid', new AbortController().signal, {
    relayUrl: 'https://relay.example',
    request: async () => {
      requested = true;
      return Response.json({});
    },
  });

  assert.equal(result.status, 'unverified');
  assert.equal(requested, false);
});
