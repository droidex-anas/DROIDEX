import assert from 'node:assert/strict';
import test from 'node:test';

import { BridgeReplayBuffer } from './bridgeReplayBuffer.js';
import type { ServerEventBatch } from './protocol.js';

function batch(firstSeq: number, lastSeq = firstSeq): ServerEventBatch {
  return {
    type: 'events.batch',
    generation: 'generation-test',
    firstSeq,
    lastSeq,
    events: [
      {
        seq: lastSeq,
        event: { type: 'connection', status: 'connected' },
      },
    ],
  };
}

function store(replay: BridgeReplayBuffer, value: ServerEventBatch): void {
  replay.push(value, JSON.stringify(value));
}

test('serves batches after a same-generation reconnect cursor', () => {
  const replay = new BridgeReplayBuffer(10_000, 10);
  store(replay, batch(1));
  store(replay, batch(2));

  const missing = replay.replayAfter(1);
  if (missing === null) throw new Error('replay unexpectedly unavailable');
  assert.equal(missing.length, 1);
  assert.equal(missing[0]?.firstSeq, 2);
  assert.equal(missing[0]?.lastSeq, 2);
});

test('reports a replay gap once batches are evicted by count or by bytes', () => {
  const byCount = new BridgeReplayBuffer(10_000, 2);
  store(byCount, batch(1));
  store(byCount, batch(2));
  store(byCount, batch(3));
  assert.equal(byCount.snapshot().firstSeq, 2);
  assert.equal(byCount.replayAfter(0), null);
  assert.deepEqual(byCount.replayAfter(3), []);

  // One batch larger than the whole byte budget is never kept.
  const byBytes = new BridgeReplayBuffer(1, 10);
  store(byBytes, batch(1));
  assert.equal(byBytes.snapshot().batches, 0);
  assert.equal(byBytes.snapshot().lastSeq, 1);
  assert.equal(byBytes.replayAfter(0), null);
});

test('rejects overlapping, out-of-order, or gapped batches', () => {
  const replay = new BridgeReplayBuffer(10_000, 10);
  const first = batch(1);
  store(replay, first);
  assert.throws(() => store(replay, first), /sequence order/);
  assert.throws(() => store(replay, batch(0)), /sequence order/);
  assert.throws(() => store(replay, batch(3)), /sequence order/);
});
