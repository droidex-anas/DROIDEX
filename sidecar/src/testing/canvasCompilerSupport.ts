import childProcess from 'node:child_process';
import { syncBuiltinESMExports } from 'node:module';
import type { TestContext } from 'node:test';
import type { CompilerRequest } from '../canvas/compiler.js';

/** IPC replies, kill delivery and process exit are independent events. */
export class ControlledCompilerProcess extends childProcess.ChildProcess {
  readonly requests: CompilerRequest[] = [];
  readonly signals: (NodeJS.Signals | number)[] = [];
  override killed = false;
  override exitCode: number | null = null;
  override connected = true;

  override send(request: CompilerRequest): boolean {
    this.requests.push(request);
    return true;
  }

  override kill(signal: NodeJS.Signals | number = 'SIGTERM'): boolean {
    this.signals.push(signal);
    this.killed = true;
    return true;
  }

  exit(): void {
    if (this.exitCode !== null) return;
    this.exitCode = 0;
    this.connected = false;
    this.emit('exit', 0, null);
  }
}

export function mockCompilerProcesses(t: TestContext): ControlledCompilerProcess[] {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const children: ControlledCompilerProcess[] = [];
  const fork = t.mock.method(childProcess, 'fork', () => {
    const child = new ControlledCompilerProcess();
    children.push(child);
    return child;
  });
  syncBuiltinESMExports();
  t.after(() => {
    for (const child of children) child.exit();
    fork.mock.restore();
    syncBuiltinESMExports();
  });
  return children;
}
