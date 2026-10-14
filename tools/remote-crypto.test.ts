import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  acceptHostHello,
  claimProof,
  createHostHello,
  createIdentity,
  finishHostHello,
  fingerprint,
  hostProof,
  signIdentity,
  totpCode,
  verifyIdentity,
  verifyTotp,
} from '../packages/remote/src/index';

async function paired() {
  const identity = await createIdentity();
  const handshake = await createHostHello('anas', identity);
  const browser = await acceptHostHello('anas', await fingerprint(identity.publicKey), handshake.hello);
  const laptop = await finishHostHello('anas', handshake, browser.clientHello);
  return { identity, handshake, browser, laptop };
}

test('pairing pins the laptop identity before accepting authenticator data', async () => {
  const identity = await createIdentity();
  const attacker = await createIdentity();
  const handshake = await createHostHello('anas', attacker);
  const pin = await fingerprint(identity.publicKey);
  await assert.rejects(acceptHostHello('anas', pin, handshake.hello), /Laptop identity changed/);
  const honest = await createHostHello('anas', identity);
  await assert.rejects(acceptHostHello('someone-else', pin, honest.hello), /Laptop identity changed/);
  await assert.rejects(crypto.subtle.exportKey('jwk', identity.privateKey));
  const signature = await signIdentity(identity.privateKey, claimProof('anas', 'challenge'));
  assert.equal(await verifyIdentity(identity.publicKey, hostProof('anas', 'challenge'), signature), false);
});

test('encrypted sessions reject reflection, replay, tampering and frames from old sessions', async () => {
  const { browser, laptop } = await paired();
  const messages = await Promise.all([
    browser.channel.encrypt({ type: 'authenticate', code: '123456' }),
    browser.channel.encrypt({ type: 'list' }),
  ]);
  await assert.rejects(browser.channel.decrypt(messages[0]));
  const tampered = { ...messages[0], ciphertext: `${messages[0].ciphertext.slice(0, -2)}AA` };
  await assert.rejects(laptop.decrypt(tampered));
  assert.deepEqual(await laptop.decrypt(messages[0]), { type: 'authenticate', code: '123456' });
  await assert.rejects(laptop.decrypt(messages[0]), /replayed/);
  assert.deepEqual(await laptop.decrypt(messages[1]), { type: 'list' });
  const response = await laptop.encrypt({ type: 'snapshot', sessions: [] });
  assert.deepEqual(await browser.channel.decrypt(response), { type: 'snapshot', sessions: [] });
  const fresh = await paired();
  await assert.rejects(fresh.laptop.decrypt(messages[0]));
  assert.notEqual(browser.channel.challenge, fresh.browser.channel.challenge);
});

test('authenticator follows RFC 6238 and rejects reused codes', async () => {
  const secret = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ';
  for (const [seconds, expected] of [[59, '287082'], [1111111109, '081804'], [2000000000, '279037']] as const) {
    assert.equal(await totpCode(secret, Math.floor(seconds / 30)), expected);
  }
  assert.equal(await verifyTotp(secret, '287082', 59_000), 1);
  assert.equal(await verifyTotp(secret, '287082', 59_000, 1), null);
  assert.equal(await verifyTotp(secret, '000000', 59_000), null);
});
