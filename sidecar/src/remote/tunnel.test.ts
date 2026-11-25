import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { EventEmitter, once } from 'node:events';
import { test } from 'node:test';
import { SendBudget, Tunnel, type TunnelFrame } from '../../../packages/remote/src/tunnel';

const UNLIMITED = { bytesPerSecond: Number.MAX_SAFE_INTEGER, framesPerSecond: 1_000_000 };

function tunnelPair(messageCount: number) {
  const received: unknown[] = [];
  const events = new EventEmitter();
  const delivered = once(events, 'delivered');
  const fail = (error: unknown) => events.emit('error', error);
  let unacked = 0;
  let maxUnacked = 0;
  let largestChunk = 0;
  let zippedChunks = 0;
  // Each side delivers on a later turn, like a socket, so the window matters.
  const deliver = (target: () => Tunnel, frame: TunnelFrame) => {
    setImmediate(() => {
      void target()
        .receive(JSON.parse(JSON.stringify(frame)))
        .catch(fail);
    });
    return Promise.resolve();
  };
  const sender: Tunnel = new Tunnel({
    write: (frame) => {
      if (frame.type === 'chunk') {
        unacked = frame.seq - acked;
        maxUnacked = Math.max(maxUnacked, unacked);
        largestChunk = Math.max(largestChunk, frame.data.length);
        if (frame.zip) zippedChunks += 1;
      }
      return deliver(() => receiver, frame);
    },
    deliver: () => fail(new Error('sender received a message')),
    fail,
    budget: new SendBudget(UNLIMITED),
    maxReceiveChars: 1024,
  });
  let acked = 0;
  const receiver: Tunnel = new Tunnel({
    write: (frame) => {
      if (frame.type === 'ack') acked = frame.seq;
      return deliver(() => sender, frame);
    },
    deliver: (message) => {
      received.push(message);
      if (received.length === messageCount) events.emit('delivered');
    },
    fail,
    budget: new SendBudget(UNLIMITED),
    maxReceiveChars: 64 * 1024 * 1024,
  });
  return {
    sender,
    received,
    delivered,
    stats: () => ({ maxUnacked, largestChunk, zippedChunks }),
  };
}

test(
  'tunnel delivers large and small messages in order within the chunk window',
  { timeout: 10_000 },
  async () => {
    const { sender, received, delivered, stats } = tunnelPair(3);
    const large = randomBytes(600_000).toString('base64');
    sender.send({ n: 1 });
    sender.send({ n: 2, large });
    sender.send({ n: 3 });

    await delivered;

    assert.deepEqual(received, [{ n: 1 }, { n: 2, large }, { n: 3 }]);
    assert.ok(stats().maxUnacked <= 4, `window exceeded: ${String(stats().maxUnacked)}`);
    assert.ok(stats().largestChunk <= 40_000);
    assert.equal(stats().zippedChunks, 0);
    assert.equal(sender.queuedChars, 0);
  },
);

test('large compressible packets reassemble across compressed chunks in order', async () => {
  const { sender, received, delivered, stats } = tunnelPair(2);
  const large = randomBytes(40_000).toString('base64') + 'abcdefgh'.repeat(3_333);
  sender.send({ n: 1 });
  sender.send({ n: 2, large });

  await delivered;

  assert.deepEqual(received, [{ n: 1 }, { n: 2, large }]);
  assert.ok(stats().zippedChunks > 1, `compressed chunks: ${String(stats().zippedChunks)}`);
});

test('compressible medium packets cross the tunnel compressed without changing order', async () => {
  const { sender, received, delivered, stats } = tunnelPair(2);
  const text = 'compressible transcript text '.repeat(50);
  sender.send({ n: 1 });
  sender.send({ n: 2, text });

  await delivered;

  assert.deepEqual(received, [{ n: 1 }, { n: 2, text }]);
  assert.equal(stats().zippedChunks, 1);
});

test('tunnel rejects a frame that skips the sequence', async () => {
  const tunnel = new Tunnel({
    write: () => Promise.resolve(),
    deliver: () => undefined,
    fail: () => undefined,
    budget: new SendBudget(UNLIMITED),
    maxReceiveChars: 1024,
  });

  await assert.rejects(
    tunnel.receive({ type: 'chunk', seq: 2, end: true, zip: false, data: '[]' }),
    /out of order/,
  );
});

test('flush resolves only after the last message is written, so a closing reason reaches the browser', async () => {
  const written: TunnelFrame[] = [];
  let finishWrite = () => {};
  const tunnel = new Tunnel({
    write: (frame) =>
      new Promise<void>((resolve) => {
        finishWrite = () => {
          written.push(frame);
          resolve();
        };
      }),
    deliver: () => undefined,
    fail: () => undefined,
    budget: new SendBudget(UNLIMITED),
    maxReceiveChars: 1024,
  });
  tunnel.send({ type: 'denied' });
  let flushed = false;
  const flush = tunnel.flush().then(() => {
    flushed = true;
  });
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(flushed, false);

  finishWrite();
  await flush;
  assert.deepEqual(
    written.map((frame) => (frame.type === 'chunk' ? frame.data : '')),
    ['[{"type":"denied"}]'],
  );
  await tunnel.flush();
});

test('send budget waits once a second of frames is spent', () => {
  let now = 10_000;
  const budget = new SendBudget({ bytesPerSecond: 1000, framesPerSecond: 2 }, () => now);

  assert.equal(budget.reserve(400), 0);
  assert.equal(budget.reserve(400), 0);
  assert.equal(budget.reserve(10), 1000);
  now += 999;
  assert.equal(budget.reserve(10), 1);
  now += 1;
  assert.equal(budget.reserve(10), 0);
});
