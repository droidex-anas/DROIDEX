import { spawn, type ChildProcess } from 'node:child_process';
import type { WaitForTerminalExitResponse } from '@agentclientprotocol/sdk';
import { childEnv } from '../../childEnv.js';
import { tolerantCommandRunner } from '../../processes/processTree.js';

// Keep the group leader alive until release; only a live member may signal its group.
// Never rename it with process.title: macOS would register each Electron helper
// as another foreground DROIDEX app in the Dock.
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
process.on('error', killGroup);
process.once('message', ({ command: executable, args, env }) => {
  if (stopping) return;
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

async function waitForGroupExit(pgid: number): Promise<void> {
  const deadline = Date.now() + 3000;
  for (;;) {
    const table = await tolerantCommandRunner('ps', ['-axo', 'pgid=,stat=']);
    const running = table.split('\n').some((line) => {
      const row = /^\s*(\d+)\s+(\S+)/.exec(line);
      return row !== null && Number(row[1]) === pgid && !row[2].startsWith('Z');
    });
    if (!running) return;
    if (Date.now() >= deadline) throw new Error('Devin terminal process group did not exit.');
    await new Promise<void>((resolve) => setTimeout(resolve, 25));
  }
}

export class DevinTerminalProcess {
  private stopping?: Promise<void>;
  readonly child: ChildProcess;
  readonly displayCommand: string;
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
    this.displayCommand = `devin-terminal ${command}`;
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
      const finish = (exitCode: number | null, signal: NodeJS.Signals | null) => {
        rejectStarted(
          new Error(`Devin terminal exited before starting (${String(signal ?? exitCode)}).`),
        );
        resolveExit(status ?? { exitCode, signal });
        resolve();
      };
      child.once('close', finish);
      // Explicit IPC disconnection can suppress close even after the owner exits.
      const finishDisconnected = () => {
        if (!child.connected && !this.isAlive()) finish(child.exitCode, child.signalCode);
      };
      child.once('exit', finishDisconnected);
      child.once('disconnect', finishDisconnected);
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
    this.stopping ??= this.stopGroup().catch((error: unknown) => {
      this.stopping = undefined;
      throw error;
    });
    return this.stopping;
  }

  private async stopGroup(): Promise<void> {
    if (this.isAlive()) this.child.kill('SIGTERM');
    await this.closed;
    if (process.platform !== 'win32' && this.child.pid !== undefined)
      await waitForGroupExit(this.child.pid);
  }
}
