import assert from 'node:assert/strict';
import test from 'node:test';
import { createTerminalOutputPump, trimUtf8Prefix, utf8ByteLength } from './terminalOutputPump';

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
  const writes: string[] = [];
  const pump = createTerminalOutputPump({
    write: (data) => writes.push(data),
    isHidden: () => true,
    scheduleFrame: () => 1,
    cancelFrame: () => undefined,
    maxHiddenBytes: 8,
  });

  pump.push(`🙂${'a'.repeat(10)}`);
  assert.equal(pump.truncated, true);
  assert.equal(pump.droppedBytes > 0, true);
  assert.equal(utf8ByteLength(trimUtf8Prefix(`🙂${'a'.repeat(10)}`, 6).text) <= 8, true);
  assert.deepEqual(writes, []);
});
