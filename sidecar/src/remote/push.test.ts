import assert from 'node:assert/strict';
import {
  createDecipheriv,
  createECDH,
  createPublicKey,
  hkdfSync,
  randomBytes,
  verify,
} from 'node:crypto';
import { test } from 'node:test';
import { isRecord } from '../../../packages/remote/src/crypto.js';
import { createPushIdentity, createPushNotifications, validatePushSubscription } from './push.js';
import { loadHostState, privateKeySchema } from './hostState.js';

function recipient() {
  const key = createECDH('prime256v1');
  const point = key.generateKeys();
  const auth = randomBytes(16);
  const subscription = {
    endpoint: 'https://fcm.googleapis.com/fcm/send/test-subscription',
    keys: { p256dh: point.toString('base64url'), auth: auth.toString('base64url') },
  };
  return { key, point, auth, subscription };
}

async function notificationState() {
  const receiver = recipient();
  const identity = await createPushIdentity();
  const state = await loadHostState(() => Promise.resolve(null), {
    relayUrl: 'wss://relay.test',
    clientUrl: 'https://droidex.vercel.app',
  });
  state.settings.enabled = true;
  state.settings.profile.username = 'anas';
  state.pushIdentity = {
    publicKey: identity.publicKey,
    privateKey: privateKeySchema.parse(identity.privateKey),
  };
  state.devices = [
    {
      id: 'phone',
      name: 'Phone',
      publicKey: {
        kty: 'EC',
        crv: 'P-256',
        x: receiver.point.subarray(1, 33).toString('base64url'),
        y: receiver.point.subarray(33).toString('base64url'),
      },
      expiresAt: Date.now() + 60_000,
      lastSeenAt: Date.now(),
    },
  ];
  state.subscriptions.phone = receiver.subscription;
  return { ...receiver, identity, state };
}

test('push accepts supported services and rejects SSRF and invalid curve points', () => {
  const { subscription } = recipient();
  assert.equal(validatePushSubscription(subscription).endpoint, subscription.endpoint);
  for (const endpoint of [
    'https://127.0.0.1/push',
    'http://fcm.googleapis.com/push',
    'https://fcm.googleapis.com.attacker.example/push',
    'https://user:password@web.push.apple.com/push',
    'https://web.push.apple.com:8443/push',
  ])
    assert.throws(() => validatePushSubscription({ ...subscription, endpoint }), /push service/);
  assert.throws(
    () =>
      validatePushSubscription({
        ...subscription,
        keys: { ...subscription.keys, auth: 'invalid' },
      }),
    /subscription key/,
  );
  const invalidPoint = Buffer.alloc(65);
  invalidPoint[0] = 4;
  assert.throws(() =>
    validatePushSubscription({
      ...subscription,
      keys: { ...subscription.keys, p256dh: invalidPoint.toString('base64url') },
    }),
  );
});

test('a subscription recipient decrypts the notification and verifies its VAPID signature', async (t) => {
  const {
    key: recipientKey,
    point,
    auth,
    subscription,
    identity,
    state,
  } = await notificationState();
  let request: RequestInit | undefined;
  t.mock.method(globalThis, 'fetch', (url: string, init: RequestInit) => {
    assert.equal(url, subscription.endpoint);
    request = init;
    return Promise.resolve(new Response(null, { status: 201 }));
  });
  const errors: string[] = [];
  const push = createPushNotifications(
    () => state,
    () => Promise.resolve(),
    (message) => {
      errors.push(message);
    },
  );
  push.notify();
  await new Promise<void>((resolve) => {
    setImmediate(resolve);
  });
  assert.deepEqual(errors, []);
  assert.ok(request);
  assert.equal(request.redirect, 'error');
  assert.equal(request.method, 'POST');
  assert.ok(request.signal instanceof AbortSignal);
  const headers = new Headers(request.headers);
  assert.equal(headers.get('Content-Encoding'), 'aes128gcm');
  assert.equal(headers.get('TTL'), '60');
  assert.ok(request.body instanceof Uint8Array);
  const body = Buffer.from(request.body);
  const salt = body.subarray(0, 16);
  assert.equal(body.readUInt32BE(16), 4096);
  assert.equal(body[20], 65);
  const senderPoint = body.subarray(21, 86);
  const secret = recipientKey.computeSecret(senderPoint);
  const material = Buffer.from(
    hkdfSync(
      'sha256',
      secret,
      auth,
      Buffer.concat([Buffer.from('WebPush: info\0'), point, senderPoint]),
      32,
    ),
  );
  const contentKey = Buffer.from(
    hkdfSync('sha256', material, salt, 'Content-Encoding: aes128gcm\0', 16),
  );
  const nonce = Buffer.from(hkdfSync('sha256', material, salt, 'Content-Encoding: nonce\0', 12));
  const decipher = createDecipheriv('aes-128-gcm', contentKey, nonce);
  decipher.setAuthTag(body.subarray(-16));
  const plaintext = Buffer.concat([decipher.update(body.subarray(86, -16)), decipher.final()]);
  assert.equal(plaintext.at(-1), 2);
  assert.deepEqual(JSON.parse(plaintext.subarray(0, -1).toString()), {
    title: 'DROIDEX needs your attention',
    body: 'Open Remote to review a pending request.',
    url: 'https://droidex.vercel.app/anas',
  });
  const authorization = headers.get('Authorization');
  assert.ok(authorization);
  const token = authorization.match(/^vapid t=([^,]+), k=(.+)$/);
  assert.ok(token);
  assert.equal(token[2], identity.publicKey);
  const [encodedHeader, encodedClaims, signature] = token[1].split('.');
  assert.deepEqual(JSON.parse(Buffer.from(encodedHeader, 'base64url').toString()), {
    typ: 'JWT',
    alg: 'ES256',
  });
  const claims: unknown = JSON.parse(Buffer.from(encodedClaims, 'base64url').toString());
  assert.ok(isRecord(claims));
  assert.equal(claims.aud, 'https://fcm.googleapis.com');
  assert.equal(claims.sub, 'https://droidex.vercel.app');
  const signingPoint = Buffer.from(identity.publicKey, 'base64url');
  const signingKey = createPublicKey({
    format: 'jwk',
    key: {
      kty: 'EC',
      crv: 'P-256',
      x: signingPoint.subarray(1, 33).toString('base64url'),
      y: signingPoint.subarray(33).toString('base64url'),
    },
  });
  assert.equal(
    verify(
      'sha256',
      Buffer.from(`${encodedHeader}.${encodedClaims}`),
      { key: signingKey, dsaEncoding: 'ieee-p1363' },
      Buffer.from(signature, 'base64url'),
    ),
    true,
  );
});

test('notification delivery is throttled and an expired response cannot delete a renewed subscription', async (t) => {
  let now = 1_000_000;
  t.mock.method(Date, 'now', () => now);
  const { subscription, state } = await notificationState();
  const deliveries: ((response: Response) => void)[] = [];
  t.mock.method(
    globalThis,
    'fetch',
    () =>
      new Promise<Response>((resolve) => {
        deliveries.push(resolve);
      }),
  );
  let saves = 0;
  const errors: string[] = [];
  const push = createPushNotifications(
    () => state,
    () => {
      saves++;
      return Promise.resolve();
    },
    (message) => {
      errors.push(message);
    },
  );
  push.notify();
  push.notify();
  assert.equal(deliveries.length, 1);
  const renewed = { ...subscription, endpoint: `${subscription.endpoint}-renewed` };
  state.subscriptions.phone = renewed;
  deliveries[0](new Response(null, { status: 410 }));
  await new Promise<void>((resolve) => {
    setImmediate(resolve);
  });
  assert.equal(state.subscriptions.phone, renewed);
  assert.equal(saves, 0);
  now += 30_000;
  push.notify();
  assert.equal(deliveries.length, 2);
  deliveries[1](new Response(null, { status: 410 }));
  await new Promise<void>((resolve) => {
    setImmediate(resolve);
  });
  assert.equal(Object.hasOwn(state.subscriptions, 'phone'), false);
  assert.equal(saves, 1);
  assert.deepEqual(errors, []);
});
