import { authenticatorUri, createTotpSecret } from '../../../packages/remote/src/index.js';
import { importIdentity, privateKeySchema, validateUrls } from './hostState.js';
import { claimHandle } from './relayConnection.js';
import { createPushIdentity } from './push.js';
import {
  fingerprint,
  isRecord,
  publicKey,
  verifyIdentity,
  verifyTotp,
  type SecureChannel,
} from '../../../packages/remote/src/index.js';
import type { RemoteDevice } from '../../../packages/remote/src/desktop.js';
import type { Stored } from './hostState.js';

type Authentication =
  | { kind: 'trusted'; device: RemoteDevice }
  | { kind: 'new'; id: string; key: JsonWebKey; name: string }
  | { kind: 'locked' };

export async function authenticateDevice(
  state: Stored,
  channel: SecureChannel,
  value: unknown,
  isActive: () => boolean,
): Promise<Authentication> {
  if (
    !isRecord(value) ||
    value.type !== 'auth' ||
    typeof value.signature !== 'string' ||
    typeof value.deviceName !== 'string' ||
    value.deviceName.length > 80
  )
    return { kind: 'locked' };
  const key = publicKey(value.publicKey);
  if (!(await verifyIdentity(key, channel.challenge, value.signature)) || !isActive())
    return { kind: 'locked' };
  const id = await fingerprint(key);
  if (!isActive()) return { kind: 'locked' };
  const device = state.devices.find((item) => item.id === id && item.expiresAt > Date.now());
  if (device) {
    device.lastSeenAt = Date.now();
    return { kind: 'trusted', device };
  }
  if (
    state.lockedUntil > Date.now() ||
    typeof value.code !== 'string' ||
    !state.secret ||
    !state.authenticatorReady
  )
    return { kind: 'locked' };
  if (state.lockedUntil && state.lockedUntil <= Date.now()) {
    state.failures = 0;
    state.lockedUntil = 0;
  }
  const step = await verifyTotp(state.secret, value.code, Date.now(), state.lastStep);
  if (!isActive()) return { kind: 'locked' };
  if (step === null) {
    state.failures = Math.min(5, state.failures + 1);
    if (state.failures === 5) state.lockedUntil = Date.now() + 15 * 60_000;
    return { kind: 'locked' };
  }
  state.lastStep = step;
  state.failures = 0;
  state.lockedUntil = 0;
  return { kind: 'new', id, key, name: value.deviceName.trim() || 'Phone' };
}

export async function setupAuthenticator(state: Stored, save: () => Promise<void>) {
  if (state.settings.enabled) throw new Error('Turn off remote access before setup');
  if (!state.settings.profile.username) throw new Error('Choose a username first');
  if (state.authenticatorReady)
    throw new Error('Authenticator already configured. Reset pairing to replace it');
  if (!state.privateKey) {
    const keys = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, [
      'sign',
      'verify',
    ]);
    const privateKey = await crypto.subtle.exportKey('jwk', keys.privateKey);
    state.privateKey = privateKey;
  }
  validateUrls(state.settings);
  await save();
  const identity = await importIdentity(state.privateKey);
  await claimHandle(state.settings.relayUrl, state.settings.profile.username, identity);
  if (!state.pushIdentity) {
    const generated = await createPushIdentity();
    state.pushIdentity = {
      ...generated,
      privateKey: privateKeySchema.parse(generated.privateKey),
    };
  }
  state.secret ??= createTotpSecret();
  await save();
  return {
    identity,
    secret: state.secret,
    uri: authenticatorUri(state.settings.profile.username, state.secret),
  };
}
