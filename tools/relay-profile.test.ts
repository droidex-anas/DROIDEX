import assert from 'node:assert/strict';
import test from 'node:test';
import {
  claimProof,
  createIdentity,
  decodeProfilePayload,
  encodeProfilePayload,
  profileChallengeProof,
  profilePublishProof,
  profileRevokeProof,
  profileShareProof,
  randomNonce,
  signIdentity,
  type Identity,
  type PublicProfileSnapshot,
} from '../packages/remote/src/index';
import { RelayRoom } from '../relay/src/room';
import type { ObjectState, RelaySocket } from '../relay/src/runtime';

class AutoResponse {
  constructor(
    private request: string,
    private response: string,
  ) {}
  getRequest() {
    return this.request;
  }
  getResponse() {
    return this.response;
  }
}
Object.assign(globalThis, { WebSocketRequestResponsePair: AutoResponse });

class MemoryState implements ObjectState {
  readonly values = new Map<string, unknown>();
  private pending = Promise.resolve();
  private rejectedPutKey: string | undefined;
  private rejectedDeleteKey: string | undefined;
  storage = {
    get: async <T>(key: string) => this.values.get(key) as T | undefined,
    put: async (key: string, value: unknown) => {
      if (this.rejectedPutKey === key) {
        this.rejectedPutKey = undefined;
        throw new Error(`put ${key} failed`);
      }
      this.values.set(key, structuredClone(value));
    },
    delete: async (key: string) => {
      if (this.rejectedDeleteKey === key) {
        this.rejectedDeleteKey = undefined;
        throw new Error(`delete ${key} failed`);
      }
      return this.values.delete(key);
    },
    getAlarm: async () => null,
    setAlarm: async () => undefined,
  };
  blockConcurrencyWhile<T>(callback: () => Promise<T>): Promise<T> {
    const run = this.pending.then(callback);
    this.pending = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }
  ready() {
    return this.pending;
  }
  rejectNextPut(key: string) {
    this.rejectedPutKey = key;
  }
  rejectNextDelete(key: string) {
    this.rejectedDeleteKey = key;
  }
  getWebSockets(): RelaySocket[] {
    return [];
  }
  acceptWebSocket() {}
  setWebSocketAutoResponse() {}
}

const profile = (tokens: number): PublicProfileSnapshot => ({
  version: 3,
  displayName: 'Anas',
  username: 'anas',
  generatedAt: 1_800_000_000_000,
  generatedDay: '2027-01-15',
  lifetimeTokens: tokens,
  tokensReported: true,
  tokensComplete: true,
  peakDayTokens: tokens,
  sessions: 1,
  currentStreak: 1,
  longestStreak: 1,
  trackingDay: '2023-11-14',
  days: [{ date: '2026-10-15', tokens, complete: true }],
  harnesses: [{ name: 'Codex', sessions: 1 }],
  models: [{ name: 'gpt-6', sessions: 1 }],
});

async function claim(room: RelayRoom, identity: Identity) {
  const challengeResponse = await room.fetch(request('challenge', 'POST'));
  const challenge = String((await challengeResponse.json() as { challenge: string }).challenge);
  const signature = await signIdentity(identity.privateKey, claimProof('anas', challenge));
  const response = await room.fetch(
    request('claim', 'POST', { publicKey: identity.publicKey, challenge, signature }),
  );
  assert.equal(response.status, 200);
}

async function profileChallengeRequest(identity: Identity, nonce = randomNonce()) {
  const signature = await signIdentity(
    identity.privateKey,
    profileChallengeProof('anas', nonce),
  );
  return { nonce, signature };
}

async function registerProfileChallenge(
  room: RelayRoom,
  body: { nonce: string; signature: string },
): Promise<string> {
  const response = await room.fetch(request('profile-challenge', 'POST', body));
  assert.equal(response.status, 200);
  return String(((await response.json()) as { challenge: string }).challenge);
}

async function challenge(room: RelayRoom, identity: Identity): Promise<string> {
  return registerProfileChallenge(room, await profileChallengeRequest(identity));
}

async function publication(
  identity: Identity,
  currentPayload: string | null,
  payload: string,
  nonce: string,
) {
  const [signature, authorization] = await Promise.all([
    signIdentity(identity.privateKey, profileShareProof('anas', payload)),
    signIdentity(identity.privateKey, profilePublishProof('anas', nonce, currentPayload, payload)),
  ]);
  return { challenge: nonce, currentPayload, payload, signature, authorization };
}

async function revocation(identity: Identity, payload: string, nonce: string) {
  return {
    challenge: nonce,
    currentPayload: payload,
    authorization: await signIdentity(
      identity.privateKey,
      profileRevokeProof('anas', nonce, payload),
    ),
  };
}

function request(route: string, method: string, body?: unknown) {
  return new Request(`https://relay.test/v1/handles/anas/${route}`, {
    method,
    ...(body === undefined
      ? {}
      : { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }),
  });
}

test('the public codec preserves unknown token totals separately from partial totals', () => {
  const payload = encodeProfilePayload({
    ...profile(0),
    tokensReported: false,
    tokensComplete: false,
  });
  const decoded = decodeProfilePayload(payload);
  assert.equal(decoded?.tokensReported, false);
  assert.equal(decoded?.tokensComplete, false);
  assert.equal(decoded?.lifetimeTokens, 0);
});

test('the handle owner atomically publishes, updates and revokes a signed public profile', async () => {
  const state = new MemoryState();
  const room = new RelayRoom(state);
  await state.ready();
  const identity = await createIdentity();
  await claim(room, identity);

  const first = encodeProfilePayload(profile(100));
  let nonce = await challenge(room, identity);
  let response = await room.fetch(
    request('profile', 'POST', await publication(identity, null, first, nonce)),
  );
  assert.equal(response.status, 200);
  assert.deepEqual(Object.keys(state.values.get('profile') as object).sort(), ['payload', 'signature']);
  assert.equal((await response.json() as { payload: string }).payload, first);

  const second = encodeProfilePayload(profile(200));
  nonce = await challenge(room, identity);
  response = await room.fetch(
    request('profile', 'POST', await publication(identity, first, second, nonce)),
  );
  assert.equal(response.status, 200);
  assert.equal((await room.fetch(request('profile', 'GET'))).status, 200);

  nonce = await challenge(room, identity);
  const authorization = await signIdentity(
    identity.privateKey,
    profileRevokeProof('anas', nonce, second),
  );
  response = await room.fetch(
    request('profile', 'DELETE', { challenge: nonce, currentPayload: second, authorization }),
  );
  assert.equal(response.status, 200);
  assert.equal((await room.fetch(request('profile', 'GET'))).status, 404);
  assert.equal(state.values.has('profile'), false);
});

test('replaying a cleared client challenge cannot restore a revoked profile', async () => {
  const state = new MemoryState();
  const room = new RelayRoom(state);
  await state.ready();
  const identity = await createIdentity();
  await claim(room, identity);

  const payload = encodeProfilePayload(profile(100));
  const clientRequest = await profileChallengeRequest(identity);
  const originalChallenge = await registerProfileChallenge(room, clientRequest);
  const publish = await publication(identity, null, payload, originalChallenge);
  assert.equal((await room.fetch(request('profile', 'POST', publish))).status, 200);

  const revokeChallenge = await challenge(room, identity);
  assert.equal(
    (
      await room.fetch(
        request('profile', 'DELETE', await revocation(identity, payload, revokeChallenge)),
      )
    ).status,
    200,
  );
  state.values.delete('profileChallenges');
  const replayChallenge = await registerProfileChallenge(room, clientRequest);
  assert.notEqual(replayChallenge, originalChallenge);
  assert.equal((await room.fetch(request('profile', 'POST', publish))).status, 403);
  assert.equal((await room.fetch(request('profile', 'GET'))).status, 404);
});

test('failed durable profile writes never change the warm public response', async () => {
  const state = new MemoryState();
  const room = new RelayRoom(state);
  await state.ready();
  const identity = await createIdentity();
  await claim(room, identity);
  const payload = encodeProfilePayload(profile(100));

  let nonce = await challenge(room, identity);
  state.rejectNextPut('profile');
  assert.equal(
    (
      await room.fetch(
        request('profile', 'POST', await publication(identity, null, payload, nonce)),
      )
    ).status,
    403,
  );
  assert.equal((await room.fetch(request('profile', 'GET'))).status, 404);

  nonce = await challenge(room, identity);
  assert.equal(
    (
      await room.fetch(
        request('profile', 'POST', await publication(identity, null, payload, nonce)),
      )
    ).status,
    200,
  );
  nonce = await challenge(room, identity);
  state.rejectNextDelete('profile');
  assert.equal(
    (
      await room.fetch(
        request('profile', 'DELETE', await revocation(identity, payload, nonce)),
      )
    ).status,
    403,
  );
  assert.equal(
    ((await (await room.fetch(request('profile', 'GET'))).json()) as { payload: string }).payload,
    payload,
  );
});

test('a failed durable owner claim does not authorize the warm room', async () => {
  const state = new MemoryState();
  const room = new RelayRoom(state);
  await state.ready();
  const identity = await createIdentity();
  const challengeResponse = await room.fetch(request('challenge', 'POST'));
  const nonce = String(((await challengeResponse.json()) as { challenge: string }).challenge);
  const signature = await signIdentity(identity.privateKey, claimProof('anas', nonce));
  state.rejectNextPut('owner');
  assert.equal(
    (
      await room.fetch(
        request('claim', 'POST', { publicKey: identity.publicKey, challenge: nonce, signature }),
      )
    ).status,
    403,
  );
  assert.equal(
    (
      await room.fetch(
        request('profile-challenge', 'POST', await profileChallengeRequest(identity)),
      )
    ).status,
    403,
  );
});

test('stale payloads, copied mutations and a different owner key cannot change a profile', async () => {
  const state = new MemoryState();
  const room = new RelayRoom(state);
  await state.ready();
  const owner = await createIdentity();
  const attacker = await createIdentity();
  await claim(room, owner);
  for (let index = 0; index < 8; index++) {
    assert.equal((await room.fetch(request('challenge', 'POST'))).status, 200);
  }
  const payload = encodeProfilePayload(profile(100));
  const nonce = await challenge(room, owner);
  const publish = await publication(owner, null, payload, nonce);
  assert.equal((await room.fetch(request('profile', 'POST', publish))).status, 200);
  assert.equal((await room.fetch(request('profile', 'POST', publish))).status, 403);

  const next = encodeProfilePayload(profile(200));
  const staleNonce = await challenge(room, owner);
  const stale = await publication(owner, null, next, staleNonce);
  assert.equal((await room.fetch(request('profile', 'POST', stale))).status, 409);

  const attackNonce = randomNonce();
  const attackChallengeSignature = await signIdentity(
    attacker.privateKey,
    profileChallengeProof('anas', attackNonce),
  );
  assert.equal(
    (
      await room.fetch(
        request('profile-challenge', 'POST', {
          nonce: attackNonce,
          signature: attackChallengeSignature,
        }),
      )
    ).status,
    403,
  );
  const ownerNonce = await challenge(room, owner);
  const attack = await publication(attacker, payload, next, ownerNonce);
  assert.equal((await room.fetch(request('profile', 'POST', attack))).status, 403);
  assert.equal((await room.fetch(request('profile', 'GET')).then((value) => value.json()) as { payload: string }).payload, payload);
});
