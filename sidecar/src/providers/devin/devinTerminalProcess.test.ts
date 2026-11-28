import assert from 'node:assert/strict';
import test from 'node:test';
import { tmpdir } from 'node:os';
import { childEnv } from '../../childEnv.js';
import { DevinTerminalProcess } from './devinTerminalProcess.js';
import { deferred } from '../../testing/projectServiceHarness.js';
import { tolerantCommandRunner } from '../../processes/processTree.js';

test('the terminal owner does not rename itself as user work', async (t) => {
  const terminal = new DevinTerminalProcess(
    process.execPath,
    ['-e', 'setInterval(() => {}, 1000);'],
    tmpdir(),
    childEnv(),
    () => undefined,
  );
  t.after(() => terminal.stop());
  await terminal.started;
  const command = await tolerantCommandRunner('ps', [
    '-o',
    'command=',
    '-p',
    String(terminal.child.pid),
  ]);
  assert.doesNotMatch(command.trim(), /^devin-terminal(?:\s|$)/);
});

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

test('losing the sidecar IPC connection reaps the terminal group', async (t) => {
  const ready = deferred<number>();
  const terminal = new DevinTerminalProcess(
    process.execPath,
    ['-e', 'process.stdout.write(String(process.pid)); setInterval(() => {}, 1000);'],
    tmpdir(),
    childEnv(),
    (text) => ready.resolve(Number(text)),
  );
  t.after(() => terminal.stop());
  await terminal.started;
  const pid = await ready.promise;
  terminal.child.disconnect();
  await terminal.stop();
  const status = await tolerantCommandRunner('ps', ['-o', 'stat=', '-p', String(pid)]);
  assert.match(status.trim(), /^(?:Z.*)?$/);
});
