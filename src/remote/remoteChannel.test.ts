import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createRemoteChannel, importRemoteKey, randomSecret, remoteEndpoint } from '../../shared/remoteChannel.js';

async function channels() {
  const key = await importRemoteKey(randomSecret());
  const clientNonce = randomSecret(16);
  const hostNonce = randomSecret(16);
  const [host, client] = await Promise.all([
    createRemoteChannel(key, clientNonce, hostNonce, 'host'),
    createRemoteChannel(key, clientNonce, hostNonce, 'client'),
  ]);
  return { key, clientNonce, hostNonce, host, client };
}

test('round trips ordered concurrent frames without sharing directional keys', async () => {
  const { host, client } = await channels();
  const packets = await Promise.all([host.seal({ text: 'hello' }), host.seal({ text: 'world' })]);
  assert.deepEqual(await Promise.all(packets.map((packet) => client.open(packet))), [{ text: 'hello' }, { text: 'world' }]);
  await assert.rejects(host.open(packets[0]));
  const command = await client.seal({ prompt: 'continue' });
  assert.deepEqual(await host.open(command), { prompt: 'continue' });
});

test('rejects duplicates, tampering and ciphertext from another connection', async () => {
  const { host, client, key, clientNonce } = await channels();
  const packet = await host.seal({ event: 'private transcript' });
  const modified = { ...packet, ciphertext: `${packet.ciphertext[0] === 'A' ? 'B' : 'A'}${packet.ciphertext.slice(1)}` };
  await assert.rejects(client.open(modified));
  assert.deepEqual(await client.open(packet), { event: 'private transcript' });
  await assert.rejects(client.open(packet));
  const reconnected = await createRemoteChannel(key, clientNonce, randomSecret(16), 'client');
  await assert.rejects(reconnected.open(packet));
});

test('only secure or loopback transport URLs are accepted', () => {
  assert.equal(remoteEndpoint('wss://relay.example/relay', 'socket').protocol, 'wss:');
  assert.equal(remoteEndpoint('ws://127.0.0.1:8787/relay', 'socket').protocol, 'ws:');
  for (const value of ['ws://192.168.0.2/relay', 'wss://user:pass@example.com', 'wss://example.com?token=secret']) {
    assert.throws(() => remoteEndpoint(value, 'socket'));
  }
});
