const assert = require('node:assert/strict');
const test = require('node:test');
const { ReplayBuffer } = require('./replayBuffer.cjs');

test('replay storage grows lazily and compacts after front trimming', () => {
  const replay = new ReplayBuffer(2 * 1024 * 1024);
  assert.equal(replay.storage.length, 0);
  replay.append(Buffer.alloc(1024, 120));
  assert.ok(replay.storage.length <= 2048);
  replay.trimFront(1000);
  replay.compact();
  assert.equal(replay.storage.length, 24);
  assert.deepEqual(replay.slice(), Buffer.alloc(24, 120));
  replay.trimFront(24);
  replay.compact();
  assert.equal(replay.storage.length, 0);
  replay.append(Buffer.from('again'));
  assert.equal(replay.slice().toString(), 'again');
});

test('byte ring preserves multibyte sequences crossing its physical end', () => {
  const replay = new ReplayBuffer(16);
  replay.append(Buffer.from('a'.repeat(15)));
  assert.equal(replay.append(Buffer.from('🙂é')), 5);
  assert.equal(replay.byteAt(10), 0xf0);
  assert.equal(replay.byteAt(13), 0x82);
  assert.equal(replay.slice().toString(), `${'a'.repeat(10)}🙂é`);
  assert.deepEqual(replay.slice(11), Buffer.from(`${'a'.repeat(10)}🙂é`).subarray(11));
});
