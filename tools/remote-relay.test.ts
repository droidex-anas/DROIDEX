import assert from 'node:assert/strict';
import { test } from 'node:test';
import { claimProof, createIdentity, fingerprint, hostProof, isRecord, MAX_RELAY_FRAME_BYTES, signIdentity } from '../packages/remote/src/index';
import { RelayRoom } from '../relay/src/room';
import relayWorker from '../relay/src/worker';
import type { Environment, ObjectState, RelaySocket } from '../relay/src/runtime';

Object.defineProperty(globalThis, 'WebSocketRequestResponsePair', { value: class {
  getRequest() { return 'ping'; }
  getResponse() { return 'pong'; }
} });

class Socket implements RelaySocket {
  readyState = 1;
  messages: string[] = [];
  closedWith: number | undefined;
  attachment: unknown;
  constructor(id: string, openedAt = Date.now()) {
    this.attachment = { id, handle: 'anas', host: false, authorized: false, challenge: `${id}-challenge`, openedAt, windowAt: Date.now(), messages: 0, bytes: 0, deliveryId: 0, outstanding: [] };
  }
  send(message: string): void { this.messages.push(message); }
  close(code?: number): void { this.closedWith = code; this.readyState = 3; }
  serializeAttachment(value: unknown): void { this.attachment = structuredClone(value); }
  deserializeAttachment(): unknown { return structuredClone(this.attachment); }
}

function fixture(sockets: Socket[]) {
  const stored = new Map<string, unknown>();
  let writes = 0;
  let alarm: number | null = null;
  let initialized: Promise<unknown> = Promise.resolve();
  const state: ObjectState = {
    storage: {
      get<T>(key: string) { return Promise.resolve(stored.get(key) as T | undefined); },
      put<T>(key: string, value: T) { writes++; stored.set(key, structuredClone(value)); return Promise.resolve(); },
      delete(key: string) { writes++; return Promise.resolve(stored.delete(key)); },
      getAlarm() { return Promise.resolve(alarm); },
      setAlarm(time: number) { alarm = time; return Promise.resolve(); },
    },
    blockConcurrencyWhile<T>(callback: () => Promise<T>) { const result = callback(); initialized = result; return result; },
    getWebSockets() { return sockets.filter(socket => socket.readyState === 1); },
    acceptWebSocket() {},
    setWebSocketAutoResponse() {},
  };
  return { state, initialize: () => initialized, writes: () => writes };
}

async function claimedRoom(sockets: Socket[]) {
  const identity = await createIdentity();
  const environment = fixture(sockets);
  await environment.state.storage.put('owner', { handle: 'anas', key: identity.publicKey, fingerprint: await fingerprint(identity.publicKey) });
  const room = new RelayRoom(environment.state);
  await environment.initialize();
  const host = sockets[0];
  await room.webSocketMessage(host, JSON.stringify({ type: 'host-auth', publicKey: identity.publicKey, signature: await signIdentity(identity.privateKey, hostProof('anas', 'laptop-challenge')) }));
  assert.equal(host.readyState, 1);
  assert.ok(host.messages.some(message => JSON.parse(message).type === 'host-ready'));
  return { room, environment, identity };
}

test('registry claims require one-use owner proofs and reject another laptop', async () => {
  const identity = await createIdentity();
  const environment = fixture([]);
  const room = new RelayRoom(environment.state);
  await environment.initialize();
  const getChallenge = async () => {
    const response = await room.fetch(new Request('https://relay.test/v1/handles/anas/challenge', { method: 'POST' }));
    const value: unknown = await response.json();
    assert.ok(isRecord(value) && typeof value.challenge === 'string');
    return value.challenge;
  };
  const challenge = await getChallenge();
  const body = { publicKey: identity.publicKey, challenge, signature: await signIdentity(identity.privateKey, claimProof('anas', challenge)) };
  const claim = (payload: unknown) => room.fetch(new Request('https://relay.test/v1/handles/anas/claim', { method: 'POST', body: JSON.stringify(payload) }));
  assert.equal((await claim(body)).status, 200);
  assert.deepEqual(await (await claim(body)).json(), { status: 'locked' });
  const stranger = await createIdentity();
  const next = await getChallenge();
  assert.deepEqual(await (await claim({ publicKey: stranger.publicKey, challenge: next, signature: await signIdentity(stranger.privateKey, claimProof('anas', next)) })).json(), { status: 'locked' });
});

test('public profile reads keep the relay CORS, rate limit and no-store boundary', async () => {
  let allowed = true;
  let forwarded = 0;
  const env: Environment = {
    WEB_ORIGIN: 'https://droidex.test',
    CONNECTION_LIMIT: { limit: async () => ({ success: true }) },
    PROFILE_READ_LIMIT: { limit: async () => ({ success: allowed }) },
    ROOMS: {
      idFromName: (name) => name,
      get: () => ({
        fetch: async () => {
          forwarded++;
          return Response.json({ status: 'not-found' }, { status: 404 });
        },
      }),
    },
  };
  const request = (origin = env.WEB_ORIGIN) =>
    new Request('https://relay.test/v1/handles/anas/profile', { headers: { origin } });

  const response = await relayWorker.fetch(request(), env);
  assert.equal(response.status, 404);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.equal(response.headers.get('access-control-allow-origin'), env.WEB_ORIGIN);
  assert.equal(forwarded, 1);

  assert.equal((await relayWorker.fetch(request('https://attacker.test'), env)).status, 403);
  allowed = false;
  assert.equal((await relayWorker.fetch(request(), env)).status, 429);
  assert.equal(forwarded, 1);
});

test('socket attachments restore routing and authority without per-frame durable writes', async (t) => {
  t.mock.method(Date, 'now', () => 1_000_000);
  const laptop = new Socket('laptop');
  const browser = new Socket('browser');
  const stranger = new Socket('stranger');
  const expired = new Socket('expired', Date.now() - 121_000);
  const { room, environment } = await claimedRoom([laptop, browser, stranger, expired]);
  const attacker = await createIdentity();
  await room.webSocketMessage(stranger, JSON.stringify({ type: 'host-auth', publicKey: attacker.publicKey, signature: await signIdentity(attacker.privateKey, hostProof('anas', 'stranger-challenge')) }));
  assert.equal(stranger.closedWith, 1008);
  await room.webSocketMessage(laptop, JSON.stringify({ type: 'authorize-peer', peerId: 'browser' }));
  const restored = new RelayRoom(environment.state);
  await environment.initialize();
  const writes = environment.writes();
  const payload = { type: 'encrypted', counter: 1, ciphertext: 'opaque' };
  await restored.webSocketMessage(laptop, JSON.stringify({ type: 'forward', peerId: 'browser', payload }));
  const delivered: unknown = JSON.parse(browser.messages.at(-1) ?? 'null');
  assert.ok(isRecord(delivered));
  assert.deepEqual(delivered.payload, payload);
  await restored.webSocketMessage(browser, JSON.stringify({ type: 'received', deliveryId: delivered.deliveryId }));
  assert.equal(environment.writes(), writes);
  await restored.alarm();
  assert.equal(expired.closedWith, 1008);
  assert.equal(browser.readyState, 1);
  await restored.webSocketMessage(laptop, JSON.stringify({ type: 'disconnect-peer', peerId: 'browser' }));
  assert.equal(browser.closedWith, 1008);
  assert.equal(laptop.readyState, 1);
});

test('host survives oversized envelopes and an unacknowledged browser flood', async () => {
  const laptop = new Socket('laptop');
  const oversized = new Socket('a'.repeat(36));
  const flood = new Socket('flood');
  const { room } = await claimedRoom([laptop, oversized, flood]);
  const frame = { type: 'forward', payload: { type: 'encrypted', counter: 1, ciphertext: '' } };
  frame.payload.ciphertext = 'x'.repeat(MAX_RELAY_FRAME_BYTES - JSON.stringify(frame).length);
  await room.webSocketMessage(oversized, JSON.stringify(frame));
  assert.equal(oversized.closedWith, 1009);
  assert.equal(laptop.readyState, 1);
  for (let counter = 1; counter <= 17; counter++) {
    await room.webSocketMessage(flood, JSON.stringify({ type: 'forward', payload: { type: 'encrypted', counter, ciphertext: 'x'.repeat(1024) } }));
  }
  assert.equal(flood.closedWith, 1013);
  assert.equal(laptop.readyState, 1);
});
