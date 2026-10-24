import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { test } from 'node:test';
import { SendBudget, Tunnel, type TunnelFrame } from '../../../packages/remote/src/tunnel';

const UNLIMITED = { bytesPerSecond: Number.MAX_SAFE_INTEGER, framesPerSecond: 1_000_000 };

function tunnelPair() {
  const received: unknown[] = [];
  const failures: unknown[] = [];
  let unacked = 0;
  let maxUnacked = 0;
  let largestChunk = 0;
  // Each side delivers on a later turn, like a socket, so the window matters.
  const deliver = (target: () => Tunnel, frame: TunnelFrame) => {
    setImmediate(() => {
      void target()
        .receive(JSON.parse(JSON.stringify(frame)))
        .catch((error: unknown) => failures.push(error));
    });
    return Promise.resolve();
  };
  const sender: Tunnel = new Tunnel({
    write: (frame) => {
      if (frame.type === 'chunk') {
        unacked = frame.seq - acked;
        maxUnacked = Math.max(maxUnacked, unacked);
        largestChunk = Math.max(largestChunk, frame.data.length);
      }
      return deliver(() => receiver, frame);
    },
    deliver: () => failures.push(new Error('sender received a message')),
    fail: (error) => failures.push(error),
    budget: new SendBudget(UNLIMITED),
    maxReceiveChars: 1024,
  });
  let acked = 0;
  const receiver: Tunnel = new Tunnel({
    write: (frame) => {
      if (frame.type === 'ack') acked = frame.seq;
      return deliver(() => sender, frame);
    },
    deliver: (message) => received.push(message),
    fail: (error) => failures.push(error),
    budget: new SendBudget(UNLIMITED),
    maxReceiveChars: 64 * 1024 * 1024,
  });
  return {
    sender,
    received,
    failures,
    stats: () => ({ maxUnacked, largestChunk }),
  };
}

// Compression runs on the libuv thread pool, so a busy machine can need far
// more event-loop turns than an idle one; bound the wait by time instead.
async function settle(until: () => boolean): Promise<void> {
  const deadline = Date.now() + 10_000;
  while (!until() && Date.now() < deadline) {
    await new Promise<void>((resolve) => setImmediate(resolve));
  }
}

test('tunnel delivers large and small messages in order within the chunk window', async () => {
  const { sender, received, failures, stats } = tunnelPair();
  const large = randomBytes(600_000).toString('base64');
  sender.send({ n: 1 });
  sender.send({ n: 2, large });
  sender.send({ n: 3 });

  await settle(() => received.length === 3 || failures.length > 0);

  assert.deepEqual(failures, []);
  assert.deepEqual(received, [{ n: 1 }, { n: 2, large }, { n: 3 }]);
  assert.ok(stats().maxUnacked <= 4, `window exceeded: ${String(stats().maxUnacked)}`);
  assert.ok(stats().largestChunk <= 40_000);
  assert.equal(sender.queuedChars, 0);
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
