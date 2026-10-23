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
import { loadHostState } from './hostState.js';

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
    usernameClaimed: true,
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

test('a failed username claim can be changed after restart even when another owner has published', async (t) => {
  const other = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, [
    'sign',
    'verify',
  ]);
  const payload = encodeProfilePayload({
    version: 3,
    displayName: 'Other owner',
    username: 'taken-name',
    generatedAt: Date.now(),
    generatedDay: '2026-10-23',
    trackingDay: '2026-10-23',
    lifetimeTokens: 0,
    tokensReported: false,
    tokensComplete: false,
    peakDayTokens: 0,
    sessions: 0,
    currentStreak: 0,
    longestStreak: 0,
    days: [],
    harnesses: [],
    models: [],
  });
  const published = {
    payload,
    publicKey: await crypto.subtle.exportKey('jwk', other.publicKey),
    signature: await signIdentity(other.privateKey, profileShareProof('taken-name', payload)),
  };
  let claimAvailable = false;
  t.mock.method(globalThis, 'fetch', async (input: string | URL | Request) => {
    const path = new URL(String(input)).pathname;
    if (path.endsWith('/challenge')) return Response.json({ challenge: 'test-challenge' });
    if (path.endsWith('/claim')) return new Response(null, { status: claimAvailable ? 200 : 403 });
    if (path.endsWith('/profile')) return Response.json(published);
    throw new Error('Unexpected relay request');
  });
  let stored: string | null = null;
  const options = {
    load: async () => stored,
    save: async (value: string) => {
      stored = value;
    },
    bridgeInfo: async () => ({ port: 1, token: 'unused' }),
    desktop: {
      open() {},
      close() {},
      call() {},
      listen: () => () => {},
      openTerminal: () => ({ post() {}, close() {} }),
    },
    changed() {},
    keepAwake() {},
    defaults: { relayUrl: 'wss://relay.test', clientUrl: 'https://client.test' },
  };
  let host = await createRemoteHost(options);
  t.after(() => host.close());
  await host.configure({ profile: { displayName: 'New owner', username: 'taken-name' } });
  await assert.rejects(host.setup(), /username is unavailable/);
  // The pre-release state without an ownership flag must also remain editable.
  assert.ok(stored);
  const previous: Record<string, unknown> = JSON.parse(stored);
  delete previous.usernameClaimed;
  stored = JSON.stringify(previous);
  await host.close();
  host = await createRemoteHost(options);
  assert.equal((await loadHostState(options.load, options.defaults)).usernameClaimed, false);
  await host.configure({ profile: { displayName: 'New owner', username: 'available-name' } });
  claimAvailable = true;
  await host.setup();
  assert.equal((await loadHostState(options.load, options.defaults)).usernameClaimed, true);
});
