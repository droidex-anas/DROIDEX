import type { ChildProcess } from 'node:child_process';
import type { CompilerRequest } from './compiler.js';

const SHUTDOWN_GRACE_MS = 2_000;

/** IPC loss and kill delivery do not release ownership of a living compiler. */
export function terminateCompilerProcess(compiler: ChildProcess, requestId: number): Promise<void> {
  return new Promise<void>((resolve) => {
    const grace = setTimeout(() => compiler.kill('SIGKILL'), SHUTDOWN_GRACE_MS);
    grace.unref();
    const onExit = (): void => {
      clearTimeout(grace);
      compiler.off('exit', onExit);
      compiler.off('close', onClose);
      resolve();
    };
    const onClose = (): void => {
      // A failed fork has no PID and emits close without ever emitting exit.
      if (compiler.pid === undefined) onExit();
    };
    compiler.once('exit', onExit);
    compiler.once('close', onClose);
    if (compiler.connected)
      compiler.send({ type: 'shutdown', requestId } satisfies CompilerRequest, () => {
        // A broken IPC channel still reaches the grace-kill and physical-exit boundary.
      });
  });
}
