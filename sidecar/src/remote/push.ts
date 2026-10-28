import {
  createCipheriv,
  createECDH,
  createPrivateKey,
  generateKeyPairSync,
  hkdfSync,
  randomBytes,
  sign,
  type JsonWebKey,
} from 'node:crypto';
import { isRecord } from '../../../packages/remote/src/crypto.js';
import type { Stored } from './hostState.js';

export interface PushIdentity {
  privateKey: JsonWebKey;
  publicKey: string;
}

export interface PushSubscriptionData {
  endpoint: string;
  keys: { p256dh: string; auth: string };
}

function decodeKey(value: unknown, length: number): Buffer {
  if (typeof value !== 'string' || value.length > 100 || !/^[A-Za-z0-9_-]+$/.test(value)) {
    throw new Error('Invalid push subscription key');
  }
  const bytes = Buffer.from(value, 'base64url');
  if (bytes.length !== length || bytes.toString('base64url') !== value) {
    throw new Error('Invalid push subscription key');
  }
  return bytes;
}

export function validatePushSubscription(value: unknown): PushSubscriptionData {
  if (
    !isRecord(value) ||
    typeof value.endpoint !== 'string' ||
    value.endpoint.length > 2048 ||
    !isRecord(value.keys)
  ) {
    throw new Error('Invalid push subscription');
  }
  const url = new URL(value.endpoint);
  const trusted =
    url.hostname === 'fcm.googleapis.com' ||
    url.hostname === 'web.push.apple.com' ||
    url.hostname === 'updates.push.services.mozilla.com' ||
    url.hostname.endsWith('.push.services.mozilla.com');
  if (
    !trusted ||
    url.protocol !== 'https:' ||
    url.username ||
    url.password ||
    url.port ||
    url.hash
  ) {
    throw new Error('Unsupported push service');
  }
  const point = decodeKey(value.keys.p256dh, 65);
  if (point[0] !== 4) throw new Error('Invalid push public key');
  decodeKey(value.keys.auth, 16);
  // OpenSSL verifies the subscription point lies on P-256 before we persist it.
  const validator = createECDH('prime256v1');
  validator.generateKeys();
  validator.computeSecret(point);
  return {
    endpoint: url.href,
    keys: { p256dh: point.toString('base64url'), auth: String(value.keys.auth) },
  };
}

export function createPushIdentity(): Promise<PushIdentity> {
  const keys = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const privateKey = keys.privateKey.export({ format: 'jwk' });
  const publicKey = keys.publicKey.export({ format: 'jwk' });
  const point = Buffer.concat([
    Buffer.from([4]),
    decodeKey(publicKey.x, 32),
    decodeKey(publicKey.y, 32),
  ]);
  return Promise.resolve({ privateKey, publicKey: point.toString('base64url') });
}

function encryptedNotification(subscription: PushSubscriptionData, clientUrl: string): Buffer {
  const recipient = decodeKey(subscription.keys.p256dh, 65);
  const auth = decodeKey(subscription.keys.auth, 16);
  const sender = createECDH('prime256v1');
  const senderPublic = sender.generateKeys();
  const secret = sender.computeSecret(recipient);
  const info = Buffer.concat([Buffer.from('WebPush: info\0'), recipient, senderPublic]);
  const material = Buffer.from(hkdfSync('sha256', secret, auth, info, 32));
  const salt = randomBytes(16);
  const key = hkdfSync('sha256', material, salt, 'Content-Encoding: aes128gcm\0', 16);
  const nonce = hkdfSync('sha256', material, salt, 'Content-Encoding: nonce\0', 12);
  const plaintext = Buffer.from(
    JSON.stringify({
      title: 'DROIDEX needs your attention',
      body: 'Open Remote to review a pending request.',
      url: clientUrl,
    }),
  );
  if (plaintext.length > 3993) throw new Error('Push notification too large');
  const cipher = createCipheriv('aes-128-gcm', Buffer.from(key), Buffer.from(nonce));
  const record = Buffer.concat([
    cipher.update(Buffer.concat([plaintext, Buffer.from([2])])),
    cipher.final(),
    cipher.getAuthTag(),
  ]);
  const header = Buffer.alloc(21);
  salt.copy(header);
  header.writeUInt32BE(4096, 16);
  header[20] = senderPublic.length;
  return Buffer.concat([header, senderPublic, record]);
}

async function sendRemotePush(
  subscription: PushSubscriptionData,
  identity: PushIdentity,
  clientUrl: string,
): Promise<'sent' | 'expired'> {
  const validated = validatePushSubscription(subscription);
  const client = new URL(clientUrl);
  if (
    client.protocol !== 'https:' ||
    client.username ||
    client.password ||
    client.hash ||
    clientUrl.length > 2048
  ) {
    throw new Error('Push requires a secure Remote client URL');
  }
  const header = Buffer.from(JSON.stringify({ typ: 'JWT', alg: 'ES256' })).toString('base64url');
  const claims = Buffer.from(
    JSON.stringify({
      aud: new URL(validated.endpoint).origin,
      exp: Math.floor(Date.now() / 1000) + 3600,
      sub: client.origin,
    }),
  ).toString('base64url');
  const unsigned = `${header}.${claims}`;
  const privateKey = createPrivateKey({ key: identity.privateKey, format: 'jwk' });
  const signature = sign('sha256', Buffer.from(unsigned), {
    key: privateKey,
    dsaEncoding: 'ieee-p1363',
  }).toString('base64url');
  const encrypted = encryptedNotification(validated, client.href);
  const response = await fetch(validated.endpoint, {
    method: 'POST',
    headers: {
      Authorization: `vapid t=${unsigned}.${signature}, k=${identity.publicKey}`,
      'Content-Type': 'application/octet-stream',
      'Content-Encoding': 'aes128gcm',
      TTL: '60',
      Urgency: 'high',
      Topic: 'droidex-attention',
    },
    body: new Uint8Array(encrypted),
    redirect: 'error',
    signal: AbortSignal.timeout(8000),
  });
  await response.body?.cancel();
  if (response.status === 404 || response.status === 410) return 'expired';
  if (!response.ok) throw new Error(`Push delivery failed (${String(response.status)})`);
  return 'sent';
}

export function createPushNotifications(
  getState: () => Stored,
  save: () => Promise<void>,
  failed: (message: string) => void,
): { notify(): void } {
  let lastPushAt = 0;
  return {
    notify() {
      const state = getState();
      const now = Date.now();
      if (!state.settings.enabled || !state.pushIdentity || now - lastPushAt < 30_000) return;
      lastPushAt = now;
      const url = `${state.settings.clientUrl.replace(/\/$/, '')}/${state.settings.profile.username}`;
      for (const device of state.devices) {
        if (device.expiresAt <= now || !Object.hasOwn(state.subscriptions, device.id)) continue;
        const subscription = state.subscriptions[device.id];
        void sendRemotePush(subscription, state.pushIdentity, url)
          .then(async (result) => {
            const current = getState();
            if (result !== 'expired' || current.subscriptions[device.id] !== subscription) return;
            Reflect.deleteProperty(current.subscriptions, device.id);
            try {
              await save();
            } catch {
              failed('Could not save notification settings');
            }
          })
          .catch(() => {
            failed('Push delivery failed. Open the web app to reconnect.');
          });
      }
    },
  };
}
