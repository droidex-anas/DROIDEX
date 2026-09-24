import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { randomBytes } from 'node:crypto';
import { test } from 'node:test';
import { createRelayHub, roomId, tokenHash, MAX_FRAME_BYTES } from './hub.mjs';

class Socket extends EventEmitter {
  readyState = 1;
  bufferedAmount = 0;
  sent = [];
  closeCode = null;
  send(value) { this.sent.push(JSON.parse(value)); }
  receive(value) { this.emit('message', Buffer.from(JSON.stringify(value)), false); }
  close(code) {
    if (this.readyState !== 1) return;
    this.closeCode = code;
    this.readyState = 3;
    this.emit('close');
  }
  terminate() { this.close(1006); }
  ping() { this.emit('pong'); }
}

function pair(t) {
  const hub = createRelayHub();
  t.after(() => hub.close());
  const host = new Socket();
  const client = new Socket();
  const hostToken = randomBytes(32).toString('base64url');
  const clientToken = randomBytes(32).toString('base64url');
  hub.attach(host);
  host.receive({ v: 1, role: 'host', hostToken, clientTokenHash: tokenHash(clientToken) });
  hub.attach(client);
  client.receive({ v: 1, role: 'client', roomId: roomId(hostToken), clientToken });
  return { hub, host, client, hostToken, clientToken };
}

test('forwards opaque data in both directions and separates control frames', (t) => {
  const { host, client } = pair(t);
  const encrypted = '{"type":"peer","online":false,"ciphertext":"opaque"}';
  client.receive({ type: 'data', data: encrypted });
  assert.deepEqual(host.sent.at(-1), { type: 'data', data: encrypted });
  host.receive({ type: 'data', data: 'encrypted reply' });
  assert.deepEqual(client.sent.at(-1), { type: 'data', data: 'encrypted reply' });
  client.receive({ type: 'peer', online: false });
  assert.equal(client.closeCode, 1008);
});

test('rejects the wrong credential without displacing either peer', (t) => {
  const { hub, host, client, hostToken } = pair(t);
  const intruder = new Socket();
  hub.attach(intruder);
  intruder.receive({ v: 1, role: 'client', roomId: roomId(hostToken), clientToken: randomBytes(32).toString('base64url') });
  assert.equal(intruder.closeCode, 1008);
  assert.equal(host.readyState, 1);
  assert.equal(client.readyState, 1);
});

test('duplicate registrations cannot replace a live host', (t) => {
  const { hub, host, hostToken, clientToken } = pair(t);
  const duplicate = new Socket();
  hub.attach(duplicate);
  duplicate.receive({ v: 1, role: 'host', hostToken, clientTokenHash: tokenHash(clientToken) });
  assert.equal(duplicate.closeCode, 1013);
  assert.equal(host.readyState, 1);
  assert.equal(hub.roomCount, 1);
});

test('a slow receiver is disconnected instead of growing an unbounded queue', (t) => {
  const { host, client } = pair(t);
  client.bufferedAmount = MAX_FRAME_BYTES * 2;
  host.receive({ type: 'data', data: 'encrypted' });
  assert.equal(client.readyState, 3);
  assert.deepEqual(host.sent.at(-1), { type: 'peer', online: false });
});

test('host shutdown destroys routing state and closes its viewer', (t) => {
  const { hub, host, client } = pair(t);
  host.close(1000);
  assert.equal(hub.roomCount, 0);
  assert.equal(client.closeCode, 1012);
});

test('malformed and oversized joins are rejected before room creation', (t) => {
  const hub = createRelayHub();
  t.after(() => hub.close());
  for (const frame of [null, [], { v: 99 }, { v: 1, role: 'host', hostToken: 'x'.repeat(MAX_FRAME_BYTES) }]) {
    const socket = new Socket();
    hub.attach(socket);
    socket.receive(frame);
    assert.equal(socket.closeCode, 1008);
  }
  assert.equal(hub.roomCount, 0);
});
