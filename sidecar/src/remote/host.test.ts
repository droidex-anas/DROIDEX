import assert from 'node:assert/strict';
import { once } from 'node:events';
import test from 'node:test';
import { WebSocketServer, type RawData, type WebSocket } from 'ws';
import {
  acceptHostHello,
  createIdentity,
  createTotpSecret,
  fingerprint,
  isRecord,
  publicKey,
  SendBudget,
  signIdentity,
  Tunnel,
  type Identity,
  type SecureChannel,
  type TunnelFrame,
} from '../../../packages/remote/src/index.js';
import { remoteMessage, type RemoteMessage } from '../../../packages/remote/src/application.js';
import { createRemoteHost } from './host.js';
import { loadHostState } from './hostState.js';

const UNLIMITED = { bytesPerSecond: Number.MAX_SAFE_INTEGER, framesPerSecond: 1_000_000 };

/** An in-process relay whose browsers can hold acknowledgements or send auth bursts. */
async function relayWithBrowser(laptopKey: JsonWebKey, browser: Identity, autoAuth = true) {
  const server = new WebSocketServer({ host: '127.0.0.1', port: 0 });
  await once(server, 'listening');
  const address = server.address();
  assert.ok(address !== null && typeof address === 'object');
  const relayed: string[] = [];
  const waiters: { until: () => boolean; resolve: () => void }[] = [];
  const settle = () => {
    for (const waiter of waiters.splice(0)) {
      if (waiter.until()) waiter.resolve();
      else waiters.push(waiter);
    }
  };
  const until = (condition: () => boolean): Promise<void> =>
    new Promise((resolve) => {
      waiters.push({ until: condition, resolve });
      settle();
    });
  let laptop: WebSocket | undefined;
  const peers = new Map<string, ReturnType<typeof addBrowser>>();
  function addBrowser(id: string, identity: Identity, authenticate = true) {
    const received: RemoteMessage['type'][] = [];
    let acknowledging = true;
    let unsentAck: TunnelFrame | undefined;
    let channel: SecureChannel | undefined;
    let tunnel: Tunnel | undefined;
    let queue = Promise.resolve();
    let chunksSent = 0;
    let acked = 0;
    const toLaptop = (payload: unknown) => {
      assert.ok(laptop);
      laptop.send(JSON.stringify({ type: 'forward', peerId: id, payload }));
    };

    async function deliver(payload: unknown): Promise<void> {
      if (channel && tunnel) {
        const frame = await channel.decrypt(payload);
        if (isRecord(frame) && frame.type === 'ack' && typeof frame.seq === 'number')
          acked = frame.seq;
        await tunnel.receive(frame);
        settle();
        return;
      }
      const accepted = await acceptHostHello('anas', await fingerprint(laptopKey), payload);
      const secure = accepted.channel;
      channel = secure;
      toLaptop(accepted.clientHello);
      tunnel = new Tunnel({
        write: async (frame) => {
          if (frame.type === 'chunk') chunksSent++;
          if (frame.type === 'ack' && !acknowledging) unsentAck = frame;
          else toLaptop(await secure.encrypt(frame));
        },
        deliver: (value) => {
          received.push(remoteMessage(value).type);
          settle();
        },
        fail: (error) => {
          throw error;
        },
        budget: new SendBudget(UNLIMITED),
        maxReceiveChars: 1024 * 1024,
      });
      if (authenticate) void auth();
      settle();
    }
    async function auth(count = 1) {
      await until(() => channel !== undefined);
      assert.ok(channel && tunnel);
      const request = {
        type: 'auth',
        publicKey: identity.publicKey,
        signature: await signIdentity(identity.privateKey, channel.challenge),
        deviceName: 'Phone',
      };
      for (let index = 0; index < count; index++) tunnel.send(request);
      await tunnel.flush();
      await until(() => acked >= chunksSent || peer.disconnected);
    }
    const peer = {
      received,
      disconnected: false,
      auth,
      deliver(payload: unknown) {
        queue = queue.then(() => deliver(payload));
      },
      send(request: unknown) {
        assert.ok(tunnel);
        tunnel.send(request);
      },
      stopAcknowledging() {
        acknowledging = false;
      },
      async acknowledge() {
        acknowledging = true;
        assert.ok(channel && unsentAck);
        toLaptop(await channel.encrypt(unsentAck));
      },
      close() {
        assert.ok(laptop);
        laptop.send(JSON.stringify({ type: 'peer-close', peerId: id }));
      },
    };
    peers.set(id, peer);
    laptop?.send(JSON.stringify({ type: 'peer-open', peerId: id }));
    return peer;
  }
  const first = addBrowser('phone', browser, autoAuth);

  server.on('connection', (socket) => {
    laptop = socket;
    socket.send(JSON.stringify({ type: 'relay-ready', challenge: 'challenge' }));
    socket.on('message', (raw: RawData) => {
      const message: unknown = JSON.parse(String(raw));
      assert.ok(isRecord(message) && typeof message.type === 'string');
      relayed.push(message.type);
      if (message.type === 'host-auth') {
        socket.send(JSON.stringify({ type: 'host-ready' }));
        for (const peerId of peers.keys())
          socket.send(JSON.stringify({ type: 'peer-open', peerId }));
      }
      if (message.type === 'forward') {
        assert.equal(typeof message.peerId, 'string');
        peers.get(String(message.peerId))?.deliver(message.payload);
      }
      if (message.type === 'disconnect-peer') {
        const peer = peers.get(String(message.peerId));
        if (peer) peer.disconnected = true;
      }
      settle();
    });
  });

  return {
    ...first,
    url: `ws://127.0.0.1:${String(address.port)}`,
    relayed,
    addBrowser,
    until,
    close: () => server.close(),
  };
}

test(
  'a revoked browser that stops acknowledging can no longer reach the laptop',
  { timeout: 10_000 },
  async (t) => {
    const keys = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, [
      'sign',
      'verify',
    ]);
    const browser = await createIdentity();
    const deviceId = await fingerprint(browser.publicKey);
    const relay = await relayWithBrowser(
      publicKey(await crypto.subtle.exportKey('jwk', keys.publicKey)),
      browser,
    );
    t.after(relay.close);
    const calls: string[] = [];
    const host = await createRemoteHost({
      load: async () =>
        JSON.stringify({
          settings: {
            profile: { displayName: 'Anas', username: 'anas' },
            enabled: true,
            relayUrl: relay.url,
            clientUrl: 'http://127.0.0.1:1',
            trustDays: 7,
            keepAwake: false,
            workspace: '',
          },
          privateKey: await crypto.subtle.exportKey('jwk', keys.privateKey),
          subscriptions: {},
          secret: createTotpSecret(),
          authenticatorReady: true,
          lastStep: -1,
          failures: 0,
          lockedUntil: 0,
          devices: [
            {
              id: deviceId,
              name: 'Phone',
              publicKey: browser.publicKey,
              expiresAt: Date.now() + 60_000,
              lastSeenAt: 0,
            },
          ],
        }),
      save: async () => undefined,
      bridgeInfo: async () => ({ port: 1, token: 'unused' }),
      desktop: {
        open: () => undefined,
        close: () => undefined,
        call: (_peerId, method) => {
          calls.push(method);
        },
        listen: () => () => undefined,
        openTerminal: () => ({ post: () => undefined, close: () => undefined }),
      },
      changed: () => undefined,
      keepAwake: () => undefined,
      defaults: { relayUrl: '', clientUrl: '' },
    });
    t.after(() => host.close());
    host.resume();
    await relay.until(() => relay.received.includes('authorized'));

    // Four unacknowledged pongs fill the laptop's send window.
    relay.stopAcknowledging();
    for (let pongs = 1; pongs <= 4; pongs++) {
      relay.send({ type: 'ping' });
      await relay.until(() => relay.received.filter((type) => type === 'pong').length === pongs);
    }
    const forwarded = () => relay.relayed.filter((type) => type === 'forward').length;
    const beforeCall = forwarded();
    await host.revoke(deviceId);
    relay.send({ type: 'call', id: 1, method: 'appVersion', args: [] });
    // The laptop acknowledges the call once it has dispatched it.
    await relay.until(() => forwarded() === beforeCall + 1);
    assert.deepEqual(calls, []);

    // Once the browser catches up it learns why, and only then is it disconnected.
    await relay.acknowledge();
    await relay.until(() => relay.received.includes('removed'));
    await relay.until(() => relay.relayed.includes('disconnect-peer'));
  },
);

test(
  'auth floods are bounded across peers and disconnected peers skip verification',
  { timeout: 10_000 },
  async (t) => {
    const keys = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, [
      'sign',
      'verify',
    ]);
    const browser = await createIdentity();
    const trusted = await createIdentity();
    const relay = await relayWithBrowser(
      publicKey(await crypto.subtle.exportKey('jwk', keys.publicKey)),
      browser,
      false,
    );
    t.after(relay.close);
    const state = await loadHostState(async () => null, {
      relayUrl: relay.url,
      clientUrl: 'https://client.test',
    });
    state.settings.profile.username = 'anas';
    state.settings.enabled = true;
    state.privateKey = await crypto.subtle.exportKey('jwk', keys.privateKey);
    state.devices.push({
      id: await fingerprint(trusted.publicKey),
      name: 'Trusted',
      publicKey: trusted.publicKey,
      expiresAt: Date.now() + 60_000,
      lastSeenAt: 0,
    });
    let releaseSave = () => {};
    const saveGate = new Promise<void>((resolve) => {
      releaseSave = resolve;
    });
    let saveStarted = () => {};
    const saving = new Promise<void>((resolve) => {
      saveStarted = resolve;
    });
    t.after(releaseSave);
    let saves = 0;
    const verified: string[] = [];
    const verify = crypto.subtle.verify.bind(crypto.subtle);
    t.mock.method(crypto.subtle, 'verify', (...args: Parameters<typeof crypto.subtle.verify>) => {
      const proof = new TextDecoder().decode(args[3]);
      if (proof.startsWith('droidex-remote:device:')) verified.push(proof);
      return verify(...args);
    });
    const host = await createRemoteHost({
      load: async () => JSON.stringify(state),
      save: async () => {
        saves++;
        saveStarted();
        await saveGate;
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
      defaults: { relayUrl: '', clientUrl: '' },
    });
    t.after(() => host.close());
    host.resume();
    await relay.auth(1_000);
    await saving;
    assert.equal(saves, 1);
    const queued = [];
    for (let index = 0; index < 8; index++) {
      const peer = relay.addBrowser(`queued-${String(index)}`, browser, false);
      await peer.auth();
      queued.push(peer);
    }
    assert.equal(queued[7].disconnected, true);
    assert.equal(verified.length, 1);
    queued[0].close();
    // A relay receipt from this peer orders its close before releasing the auth queue.
    await relay.auth(1);
    releaseSave();
    await Promise.all(
      queued.slice(1, 7).map((peer) => relay.until(() => peer.received.includes('locked'))),
    );
    const owner = relay.addBrowser('trusted', trusted);
    await relay.until(() => owner.received.includes('authorized'));
    assert.equal(verified.length, 8);
    assert.equal(new Set(verified).size, 8);
  },
);
