import assert from 'node:assert/strict';
import test from 'node:test';
import { tmpdir } from 'node:os';
import { childEnv } from '../../childEnv.js';
import { DevinTerminalProcess } from './devinTerminalProcess.js';

test('a dead terminal owner never signals its recycled process group', async (t) => {
  const terminal = new DevinTerminalProcess(
    process.execPath,
    ['-e', "process.kill(0, 'SIGKILL')"],
    tmpdir(),
    childEnv(),
    () => undefined,
  );
  t.after(() => terminal.stop());
  await terminal.started.catch(() => undefined);
  await terminal.closed;
  assert.equal((await terminal.exited).signal, 'SIGKILL');
  assert.equal(terminal.isAlive(), false);
  const signal = t.mock.method(process, 'kill', () => true);
  await terminal.stop();
  assert.equal(signal.mock.callCount(), 0);
});
