const assert = require('node:assert/strict');
const test = require('node:test');
const { ReplayBuffer } = require('./replayBuffer.cjs');

test('front trimming and compaction preserve replay and allow reuse', () => {
  const replay = new ReplayBuffer(2 * 1024 * 1024);
  replay.append(Buffer.alloc(1024, 120));
  replay.trimFront(1000);
  replay.compact();
  assert.deepEqual(replay.slice(), Buffer.alloc(24, 120));
  replay.trimFront(24);
  replay.compact();
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
