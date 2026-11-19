import { spawn, type ChildProcess } from 'node:child_process';
import type { WaitForTerminalExitResponse } from '@agentclientprotocol/sdk';
import { childEnv } from '../../childEnv.js';

// Keep the group leader alive until release; only a live member may signal its group.
const GROUP_OWNER = String.raw`
const { spawn } = require('node:child_process');
let command, status, drain, finished = false, stopping = false;
const killGroup = () => {
  if (process.platform === 'win32') process.exit();
  process.kill(0, 'SIGKILL');
};
const finish = () => {
  if (finished || !status) return;
  finished = true;
  clearTimeout(drain);
  if (!process.connected) return killGroup();
  process.send({ type: 'exit', status }, () => { if (stopping) killGroup(); });
};
const stop = () => {
  if (stopping) return;
  stopping = true;
  if (finished) return killGroup();
  if (status) return finish();
  if (command) command.kill('SIGTERM');
  setTimeout(killGroup, 1000);
};
process.on('SIGTERM', stop);
process.on('disconnect', killGroup);
process.once('message', ({ command: executable, args, env }) => {
  if (stopping) return;
  process.title = 'devin-terminal ' + executable;
  command = spawn(executable, args, { shell: args.length === 0, env, stdio: 'pipe', windowsHide: true });
  command.stdin.end();
  for (const stream of [command.stdout, command.stderr]) {
    stream.setEncoding('utf8').on('data', (text) => {
      if (process.connected && !process.send({ type: 'output', text }, () => stream.resume())) stream.pause();
    });
  }
  command.once('spawn', () => process.send({ type: 'started' }));
  command.once('error', (error) => process.send({ type: 'error', message: error.message }));
  command.once('exit', (exitCode, signal) => {
    status = { exitCode, signal };
    if (stopping) finish();
    else drain = setTimeout(finish, 1000);
  });
  command.once('close', finish);
});
`;

type TerminalMessage =
  | { type: 'started' }
  | { type: 'output'; text: string }
  | { type: 'exit'; status: WaitForTerminalExitResponse }
  | { type: 'error'; message: string };

export class DevinTerminalProcess {
  readonly child: ChildProcess;
  readonly started: Promise<void>;
  readonly exited: Promise<WaitForTerminalExitResponse>;
  readonly closed: Promise<void>;

  constructor(
    command: string,
    args: string[],
    cwd: string,
    env: NodeJS.ProcessEnv,
    output: (text: string) => void,
  ) {
    const child = spawn(process.execPath, ['-e', GROUP_OWNER], {
      cwd,
      env: { ...childEnv(), ELECTRON_RUN_AS_NODE: '1' },
      stdio: ['ignore', 'ignore', 'pipe', 'ipc'],
      detached: process.platform !== 'win32',
      windowsHide: true,
    });
    this.child = child;
    let resolveStarted!: () => void;
    let rejectStarted!: (error: Error) => void;
    let resolveExit!: (status: WaitForTerminalExitResponse) => void;
    let status: WaitForTerminalExitResponse | undefined;
    this.started = new Promise((resolve, reject) => {
      resolveStarted = resolve;
      rejectStarted = reject;
    });
    this.exited = new Promise((resolve) => {
      resolveExit = resolve;
    });
    this.closed = new Promise((resolve) => {
      child.once('close', (exitCode, signal) => {
        rejectStarted(
          new Error(`Devin terminal exited before starting (${String(signal ?? exitCode)}).`),
        );
        resolveExit(status ?? { exitCode, signal });
        resolve();
      });
    });
    child.once('error', rejectStarted);
    child.once('spawn', () => {
      child.send({ command, args, env }, (error) => {
        if (error) rejectStarted(error);
      });
    });
    child.on('message', (message) => {
      const event = message as TerminalMessage;
      switch (event.type) {
        case 'started':
          resolveStarted();
          break;
        case 'output':
          output(event.text);
          break;
        case 'exit':
          status = event.status;
          resolveExit(status);
          break;
        case 'error':
          rejectStarted(new Error(event.message));
          break;
      }
    });
  }

  isAlive(): boolean {
    return this.child.exitCode === null && this.child.signalCode === null;
  }

  stop(): Promise<void> {
    if (this.isAlive()) this.child.kill('SIGTERM');
    return this.closed;
  }
}
