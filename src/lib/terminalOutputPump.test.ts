import assert from 'node:assert/strict';
import test from 'node:test';
import { createTerminalOutputPump } from './terminalOutputPump';

/** A pump whose writes and scheduled animation frames the test can inspect. */
function framedPump(isHidden: () => boolean) {
  const writes: string[] = [];
  const frames: Array<() => void> = [];
  const pump = createTerminalOutputPump({
    write: (data) => writes.push(data),
    isHidden,
    scheduleFrame: (callback) => {
      frames.push(callback);
      return frames.length;
    },
    cancelFrame: () => {
      frames.length = 0;
    },
  });
  return { pump, writes, frames };
}

test('output pump coalesces visible writes onto one animation frame', () => {
  const { pump, writes, frames } = framedPump(() => false);

  pump.push('a');
  pump.push('b');
  pump.push('c');
  assert.deepEqual(writes, []);
  assert.equal(frames.length, 1);

  frames[0]?.();
  assert.deepEqual(writes, ['abc']);
});

test('output pump skips xterm writes while hidden and flushes on reveal', () => {
  let hidden = true;
  const { pump, writes, frames } = framedPump(() => hidden);

  pump.push('hello');
  assert.deepEqual(writes, []);
  assert.equal(frames.length, 0);

  hidden = false;
  pump.reveal();
  assert.deepEqual(writes, ['hello']);
});

test('hidden output is bounded with UTF-8-safe trimming', () => {
  let hidden = true;
  const writes: string[] = [];
  const pump = createTerminalOutputPump({
    write: (data) => writes.push(data),
    isHidden: () => hidden,
    scheduleFrame: () => 1,
    cancelFrame: () => undefined,
    maxHiddenBytes: 8,
  });

  pump.push(`🙂${'a'.repeat(10)}`);
  assert.equal(pump.truncated, true);
  assert.equal(pump.droppedBytes > 0, true);
  assert.deepEqual(writes, []);
  hidden = false;
  pump.reveal();
  assert.deepEqual(writes, ['a'.repeat(8)]);
});

test('hidden output evicts chunks and trims only complete UTF-8 code points', () => {
  let hidden = true;
  const writes: string[] = [];
  const pump = createTerminalOutputPump({
    write: (data) => writes.push(data),
    isHidden: () => hidden,
    scheduleFrame: () => 1,
    cancelFrame: () => undefined,
    maxHiddenBytes: 8,
  });

  pump.push('ab');
  pump.push('🙂界\n');
  assert.equal(pump.droppedBytes, 2);
  pump.push('xy');
  assert.equal(pump.droppedBytes, 6);
  assert.equal(pump.truncated, true);
  assert.deepEqual(writes, []);

  hidden = false;
  pump.reveal();
  assert.deepEqual(writes, ['界\nxy']);
  pump.flush();
  assert.deepEqual(writes, ['界\nxy']);

  for (const surrogate of ['\ud800', '\udc00']) {
    pump.reset();
    hidden = true;
    pump.push(`${surrogate}ab🙂`);
    assert.equal(pump.droppedBytes, 3);
    pump.push('xy');
    assert.equal(pump.droppedBytes, 3);
    hidden = false;
    pump.reveal();
    assert.equal(writes.at(-1), 'ab🙂xy');
  }

  const splitPump = createTerminalOutputPump({
    write: (data) => writes.push(data),
    isHidden: () => hidden,
    scheduleFrame: () => 1,
    cancelFrame: () => undefined,
    maxHiddenBytes: 6,
  });
  hidden = true;
  splitPump.push('xxx\uD83D');
  splitPump.push('\uDE42');
  splitPump.push('a');
  assert.equal(splitPump.droppedBytes, 2);
  hidden = false;
  splitPump.reveal();
  assert.equal(writes.at(-1), 'x🙂a');
});

test('split pairs remain intact when the pending block is full', () => {
  let hidden = true;
  const writes: string[] = [];
  const blockBytes = 16 * 1024;
  const pump = createTerminalOutputPump({
    write: (data) => writes.push(data),
    isHidden: () => hidden,
    scheduleFrame: () => 1,
    cancelFrame: () => undefined,
    maxHiddenBytes: blockBytes,
  });

  pump.push('x'.repeat(blockBytes - 3) + '\uD83D');
  for (let index = 0; index < 3; index += 1) pump.push('\uDE42\uD83D');
  pump.push('\uDE42');
  assert.equal(pump.droppedBytes, 13);
  hidden = false;
  pump.reveal();
  assert.deepEqual(writes, ['x'.repeat(blockBytes - 16) + '🙂'.repeat(4)]);
});
