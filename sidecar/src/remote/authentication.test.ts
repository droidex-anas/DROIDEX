import assert from 'node:assert/strict';
import test from 'node:test';
import {
  acceptHostHello,
  createHostHello,
  createIdentity,
  createTotpSecret,
  fingerprint,
  finishHostHello,
  signIdentity,
  totpCode,
  type SecureChannel,
} from '../../../packages/remote/src/index.js';
import type { RemoteDevice } from '../../../packages/remote/src/desktop.js';
import { authenticateDevice } from './authentication.js';
import { loadHostState } from './hostState.js';

async function hostChannel(): Promise<SecureChannel> {
  const laptop = await createIdentity();
  const handshake = await createHostHello('anas', laptop);
  const accepted = await acceptHostHello(
    'anas',
    await fingerprint(laptop.publicKey),
    handshake.hello,
  );
  return finishHostHello('anas', handshake, accepted.clientHello);
}

async function authRequest(channel: SecureChannel, code?: string) {
  const browser = await createIdentity();
  return {
    browser,
    request: {
      type: 'auth',
      publicKey: browser.publicKey,
      signature: await signIdentity(browser.privateKey, channel.challenge),
      deviceName: 'Phone',
      ...(code === undefined ? {} : { code }),
    },
  };
}

test('five wrong pairing codes lock new pairing but not trusted devices', async () => {
  const state = await loadHostState(async () => null, { relayUrl: '', clientUrl: '' });
  state.secret = createTotpSecret();
  state.authenticatorReady = true;
  const channel = await hostChannel();
  const correct = await totpCode(state.secret, Math.floor(Date.now() / 30_000));
  const wrong = correct === '000000' ? '111111' : '000000';

  for (let attempt = 0; attempt < 5; attempt++) {
    const { request } = await authRequest(channel, wrong);
    assert.equal((await authenticateDevice(state, channel, request, () => true)).kind, 'locked');
  }
  const { request: pairing } = await authRequest(channel, correct);
  assert.equal((await authenticateDevice(state, channel, pairing, () => true)).kind, 'locked');

  const trusted = await authRequest(channel);
  const device: RemoteDevice = {
    id: await fingerprint(trusted.browser.publicKey),
    name: 'Laptop browser',
    publicKey: trusted.browser.publicKey,
    expiresAt: Date.now() + 60_000,
    lastSeenAt: 0,
  };
  state.devices.push(device);
  assert.deepEqual(await authenticateDevice(state, channel, trusted.request, () => true), {
    kind: 'trusted',
    device,
  });
});
