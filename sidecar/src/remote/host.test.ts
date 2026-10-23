import assert from 'node:assert/strict';
import { once } from 'node:events';
import test from 'node:test';
import { WebSocketServer, type RawData } from 'ws';
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

const UNLIMITED = { bytesPerSecond: Number.MAX_SAFE_INTEGER, framesPerSecond: 1_000_000 };

/** A relay with one trusted browser on it, which can stop acknowledging what it receives. */
async function relayWithBrowser(laptopKey: JsonWebKey, browser: Identity) {
  const server = new WebSocketServer({ host: '127.0.0.1', port: 0 });
  await once(server, 'listening');
  const address = server.address();
  assert.ok(address !== null && typeof address === 'object');
  const received: RemoteMessage['type'][] = [];
  const relayed: string[] = [];
  const waiters: { until: () => boolean; resolve: () => void }[] = [];
  const settle = () => {
    for (const waiter of waiters.splice(0)) {
      if (waiter.until()) waiter.resolve();
      else waiters.push(waiter);
    }
  };
  let acknowledging = true;
  let unsentAck: TunnelFrame | undefined;
  let channel: SecureChannel | undefined;
  let tunnel: Tunnel | undefined;
  let toLaptop: (payload: unknown) => void = () => undefined;

  async function deliver(payload: unknown): Promise<void> {
    if (channel && tunnel) {
      await tunnel.receive(await channel.decrypt(payload));
      return;
    }
    const accepted = await acceptHostHello('anas', await fingerprint(laptopKey), payload);
    const secure = accepted.channel;
    channel = secure;
    toLaptop(accepted.clientHello);
    tunnel = new Tunnel({
      write: async (frame) => {
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
    tunnel.send({
      type: 'auth',
      publicKey: browser.publicKey,
      signature: await signIdentity(browser.privateKey, secure.challenge),
      deviceName: 'Phone',
    });
  }

  server.on('connection', (socket) => {
    toLaptop = (payload) => {
      socket.send(JSON.stringify({ type: 'forward', peerId: 'phone', payload }));
    };
    let queue = Promise.resolve();
    socket.send(JSON.stringify({ type: 'relay-ready', challenge: 'challenge' }));
    socket.on('message', (raw: RawData) => {
      const message: unknown = JSON.parse(String(raw));
      assert.ok(isRecord(message) && typeof message.type === 'string');
      relayed.push(message.type);
      if (message.type === 'host-auth') {
        socket.send(JSON.stringify({ type: 'host-ready' }));
        socket.send(JSON.stringify({ type: 'peer-open', peerId: 'phone' }));
      }
      if (message.type === 'forward') {
        const payload = message.payload;
        queue = queue.then(() => deliver(payload));
      }
      settle();
    });
  });

  return {
    url: `ws://127.0.0.1:${String(address.port)}`,
    received,
    relayed,
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
    until(condition: () => boolean): Promise<void> {
      return new Promise((resolve) => {
        waiters.push({ until: condition, resolve });
        settle();
      });
    },
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
