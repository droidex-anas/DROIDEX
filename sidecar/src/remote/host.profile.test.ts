import assert from 'node:assert/strict';
import test from 'node:test';
import {
  encodeProfilePayload,
  profileShareProof,
  publicKey,
  signIdentity,
  type PublicProfileSnapshot,
} from '../../../packages/remote/src/index.js';
import { createRemoteHost } from './host.js';

test('a published profile blocks relay and username changes through the host boundary', async (t) => {
  const keys = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, [
    'sign',
    'verify',
  ]);
  const privateKey = await crypto.subtle.exportKey('jwk', keys.privateKey);
  const ownerKey = publicKey(await crypto.subtle.exportKey('jwk', keys.publicKey));
  const snapshot: PublicProfileSnapshot = {
    version: 3,
    displayName: 'Anas',
    username: 'anas',
    generatedAt: 1_800_000_000_000,
    generatedDay: '2027-01-15',
    lifetimeTokens: 100,
    tokensReported: true,
    tokensComplete: true,
    peakDayTokens: 100,
    sessions: 1,
    currentStreak: 1,
    longestStreak: 1,
    trackingDay: '2023-11-14',
    days: [],
    harnesses: [],
    models: [],
  };
  const payload = encodeProfilePayload(snapshot);
  const signature = await signIdentity(keys.privateKey, profileShareProof('anas', payload));
  let relayUnavailable = false;
  const requested: string[] = [];
  t.mock.method(globalThis, 'fetch', async (input: string | URL | Request) => {
    requested.push(String(input));
    if (relayUnavailable) return new Response(null, { status: 503 });
    return Response.json({ payload, publicKey: ownerKey, signature });
  });
  const stored = JSON.stringify({
    settings: {
      profile: { displayName: 'Anas', username: 'anas' },
      enabled: false,
      relayUrl: 'wss://old-relay.test',
      clientUrl: 'https://droidex.test',
      trustDays: 7,
      keepAwake: false,
      workspace: '',
    },
    privateKey,
    subscriptions: {},
    authenticatorReady: false,
    lastStep: -1,
    failures: 0,
    lockedUntil: 0,
    devices: [],
  });
  const host = await createRemoteHost({
    load: async () => stored,
    save: async () => undefined,
    bridgeInfo: async () => ({ port: 1, token: 'unused' }),
    desktop: {
      open: () => undefined,
      close: () => undefined,
      call: () => undefined,
      listen: () => () => undefined,
      openTerminal: () => ({ post: () => undefined, close: () => undefined }),
    },
    changed: () => undefined,
    keepAwake: () => undefined,
    defaults: { relayUrl: '', clientUrl: '' },
  });
  try {
    await assert.rejects(
      host.configure({ relayUrl: 'wss://new-relay.test' }),
      /Unpublish your profile before changing username or relay/,
    );
    await assert.rejects(
      host.configure({ profile: { displayName: 'Anas', username: 'anas-new' } }),
      /Unpublish your profile before changing username or relay/,
    );
    assert.deepEqual(requested, [
      'https://old-relay.test/v1/handles/anas/profile',
      'https://old-relay.test/v1/handles/anas/profile',
    ]);

    relayUnavailable = true;
    await assert.rejects(
      host.configure({ relayUrl: 'wss://new-relay.test' }),
      /Could not load the public profile/,
    );
    assert.equal(host.snapshot().relayUrl, 'wss://old-relay.test');
  } finally {
    await host.close();
  }
});
