// The sidecar's half of the design compiler: one child process, one request per
// message, nothing else. Slots, per-design coalescing and build deadlines
// belong to `CanvasBuilds` (Task 3b), which owns this client.
//
// The compiler runs as a forked process rather than a worker thread because it
// starts esbuild's service process. libuv reaps a child only through the loop
// that spawned it, and `esbuild.stop()` kills that child without exposing it,
// so a terminated worker thread left the service `<defunct>` for the sidecar's
// whole life. A forked compiler is owned by the sidecar's own loop, and the
// service it leaves behind is reparented and reaped by init.

import { fork, type ChildProcess } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { ownedEsbuildBinary } from './canvasRuntime.js';
import type { CanvasDiagnostic, DesignSystemRef, SourceElement } from './protocol.js';
import type { SourceFiles } from './schema.js';

export interface CompileInput {
  designId: string;
  revisionId: string;
  /** The owning lifecycle generation, carried back so a result can be pinned. */
  generation: number;
  files: SourceFiles;
  designSystem: DesignSystemRef;
}

export interface CompiledDesign {
  /** sha256 of `html`, so identical input names one artifact. */
  artifactId: string;
  /** A self-contained preview document: inline stylesheet, inline bundle. */
  html: string;
  /** Warnings that accompany a usable artifact; errors arrive as a rejection. */
  diagnostics: CanvasDiagnostic[];
  /** Empty until Task 8 adds the source instrumentation that fills it. */
  elements: SourceElement[];
}

/** The design's own source is wrong. Its diagnostics are safe to show. */
export class CompileFailedError extends Error {
  constructor(readonly diagnostics: CanvasDiagnostic[]) {
    super('The design could not be compiled.');
    this.name = 'CompileFailedError';
  }
}

/** The caller abandoned the compile. Expected, and never a build failure. */
export class CompileCancelledError extends Error {
  constructor() {
    super('The design compile was cancelled.');
    this.name = 'CompileCancelledError';
  }
}

/**
 * Why a compiler could not answer, which decides what a user can do about it. A
 * damaged runtime is not something a restart repairs, and the two cases must
 * not be told apart by matching text.
 */
export type CompilerUnavailableReason = 'damaged-runtime' | 'lost-compiler';

/** The worker died, was terminated, or refused the runtime it was given. */
export class CompilerUnavailableError extends Error {
  constructor(
    readonly reason: CompilerUnavailableReason,
    message: string,
  ) {
    super(message);
    this.name = 'CompilerUnavailableError';
  }
}

export type CompilerRequest =
  | { type: 'compile'; requestId: number; input: CompileInput }
  | { type: 'cancel'; requestId: number }
  | { type: 'shutdown'; requestId: number };

export type CompilerResponse =
  | { requestId: number; status: 'ready'; design: CompiledDesign }
  | { requestId: number; status: 'failed'; diagnostics: CanvasDiagnostic[] }
  | { requestId: number; status: 'cancelled' }
  | {
      requestId: number;
      status: 'unavailable';
      reason: CompilerUnavailableReason;
      message: string;
    }
  | { requestId: number; status: 'stopped' };

interface PendingCompile {
  resolve(design: CompiledDesign): void;
  reject(error: Error): void;
  release(): void;
}

// The only two things a user can do about a compiler that cannot answer, and
// the only text safe to show: a worker's own failure carries module paths.
// `canvasBuildFailures.ts` picks between them by the reason, never by matching.
export const COMPILER_UNAVAILABLE = 'The Canvas compiler is unavailable; restart DROIDEX.';
export const RUNTIME_UNAVAILABLE =
  'The design compiler is not installed correctly. Reinstall DROIDEX.';

// How long a shutdown may take before the process is forcibly ended. This is
// cleanup, not the build deadline Task 3b owns.
const SHUTDOWN_GRACE_MS = 2_000;

export class CompilerWorker {
  private compiler: ChildProcess | null = null;
  private readonly pending = new Map<number, PendingCompile>();
  private termination: Promise<void> | null = null;
  private nextRequestId = 1;

  /**
   * Compiles one revision. Rejects with `CompileFailedError` when the source is
   * wrong, `CompileCancelledError` when `signal` aborts, and
   * `CompilerUnavailableError` when the worker dies under the call.
   */
  compile(input: CompileInput, signal: AbortSignal): Promise<CompiledDesign> {
    if (this.termination !== null)
      return Promise.reject(new CompilerUnavailableError('lost-compiler', COMPILER_UNAVAILABLE));
    if (signal.aborted) return Promise.reject(new CompileCancelledError());

    const requestId = this.nextRequestId++;
    const compiler = this.liveCompiler();
    return new Promise<CompiledDesign>((resolve, reject) => {
      const onAbort = (): void => {
        // The compiler checks its own signal between stages, but the caller is
        // answered now rather than waiting for a compile it no longer wants.
        this.settle(requestId, () => {
          reject(new CompileCancelledError());
        });
        compiler.send({ type: 'cancel', requestId } satisfies CompilerRequest);
      };
      signal.addEventListener('abort', onAbort, { once: true });
      this.pending.set(requestId, {
        resolve,
        reject,
        release: () => {
          signal.removeEventListener('abort', onAbort);
        },
      });
      compiler.send({ type: 'compile', requestId, input } satisfies CompilerRequest);
    });
  }

  /** Final: rejects all compiles, refuses new ones, and awaits the owned child's exit. */
  terminate(): Promise<void> {
    if (this.termination !== null) return this.termination;
    const compiler = this.compiler;
    this.compiler = null;
    this.termination = new Promise<void>((resolve) => {
      if (compiler === null) {
        resolve();
        return;
      }
      // Give the compiler time to stop and reap esbuild before forcing its exit.
      const grace = setTimeout(() => compiler.kill('SIGKILL'), SHUTDOWN_GRACE_MS);
      grace.unref();
      compiler.once('exit', () => {
        clearTimeout(grace);
        resolve();
      });
    });
    this.failAll(new CompilerUnavailableError('lost-compiler', COMPILER_UNAVAILABLE));
    if (compiler !== null) {
      const requestId = this.nextRequestId++;
      compiler.send({ type: 'shutdown', requestId } satisfies CompilerRequest);
    }
    return this.termination;
  }

  /**
   * The running compiler, started on first use and replaced after a crash so
   * one bad revision cannot disable the compiler for the session.
   */
  private liveCompiler(): ChildProcess {
    if (this.compiler) return this.compiler;
    const compiler = fork(compilerEntryPath(), [], {
      // The parent may run under a loader; the compiler picks its own below.
      execArgv: [],
      execPath: process.execPath,
      serialization: 'advanced',
      env: compilerEnv(),
    });
    compiler.on('message', (message: unknown) => {
      const response = compilerResponse(message);
      // A forked process is a boundary. A reply that is not one of its own
      // answers is the compiler failing, not a result to pass on, so it is
      // treated exactly like a crash: this job and every other in flight fail,
      // the process is ended, and the next build forks a replacement.
      if (response === null) {
        this.loseCompiler(compiler, new Error('The compiler sent a reply it does not define.'));
        compiler.kill();
        return;
      }
      this.receive(response);
    });
    compiler.on('error', (error: Error) => {
      this.loseCompiler(compiler, error);
    });
    compiler.on('exit', (code) => {
      this.loseCompiler(compiler, new Error(`The compiler exited with code ${String(code)}.`));
    });
    this.compiler = compiler;
    return compiler;
  }

  private receive(response: CompilerResponse): void {
    if (response.status === 'stopped') return;
    this.settle(response.requestId, (call) => {
      switch (response.status) {
        case 'ready':
          call.resolve(response.design);
          return;
        case 'failed':
          call.reject(new CompileFailedError(response.diagnostics));
          return;
        case 'cancelled':
          call.reject(new CompileCancelledError());
          return;
        case 'unavailable':
          // Already a curated recovery message from the sidecar's own storage
          // boundary, which never carries a path (spec §8).
          call.reject(new CompilerUnavailableError(response.reason, response.message));
          return;
      }
    });
  }

  /** The cause goes to the sidecar log; the caller learns only what to do. */
  private loseCompiler(compiler: ChildProcess, cause: Error): void {
    if (this.compiler !== compiler) return;
    this.compiler = null;
    console.error('Canvas compiler lost:', cause);
    this.failAll(new CompilerUnavailableError('lost-compiler', COMPILER_UNAVAILABLE));
  }

  private failAll(error: Error): void {
    for (const requestId of [...this.pending.keys()]) {
      this.settle(requestId, (call) => {
        call.reject(error);
      });
    }
  }

  /** Settles a request exactly once; a later answer for it is dropped. */
  private settle(requestId: number, finish: (call: PendingCompile) => void): void {
    const call = this.pending.get(requestId);
    if (!call) return;
    this.pending.delete(requestId);
    call.release();
    finish(call);
  }
}

const UNAVAILABLE_REASONS: readonly CompilerUnavailableReason[] = [
  'damaged-runtime',
  'lost-compiler',
];

/**
 * The child's answer, or null when what arrived is not one: the compiler is a
 * forked process, and what it sends is the one thing in this module that is not
 * this module's own. Only the shape the protocol defines is read. An answer for
 * a request nobody is waiting for is not malformed — a cancelled compile is
 * answered after its caller has already been told, and `settle` drops it — so
 * `requestId` is checked for its type and nothing more.
 */
export function compilerResponse(message: unknown): CompilerResponse | null {
  if (typeof message !== 'object' || message === null) return null;
  const {
    requestId,
    status,
    reason,
    message: text,
    design,
    diagnostics,
  } = message as Record<string, unknown>;
  if (typeof requestId !== 'number') return null;
  switch (status) {
    case 'cancelled':
    case 'stopped':
      return { requestId, status };
    case 'ready':
      return isCompiledDesign(design) ? { requestId, status, design } : null;
    case 'failed':
      return Array.isArray(diagnostics)
        ? { requestId, status, diagnostics: diagnostics as CanvasDiagnostic[] }
        : null;
    case 'unavailable':
      if (typeof text !== 'string') return null;
      if (!UNAVAILABLE_REASONS.includes(reason as CompilerUnavailableReason)) return null;
      return { requestId, status, reason: reason as CompilerUnavailableReason, message: text };
    default:
      return null;
  }
}

function isCompiledDesign(design: unknown): design is CompiledDesign {
  if (typeof design !== 'object' || design === null) return false;
  const { artifactId, html, diagnostics, elements } = design as Record<string, unknown>;
  return (
    typeof artifactId === 'string' &&
    typeof html === 'string' &&
    Array.isArray(diagnostics) &&
    Array.isArray(elements)
  );
}

/**
 * `process.execPath` is Electron's own binary in a packaged app, so the
 * compiler is told to run as Node rather than as a second Electron. A packaged
 * app also owns its esbuild binary; a checkout lets esbuild find its own.
 */
function compilerEnv(): NodeJS.ProcessEnv {
  const binary = ownedEsbuildBinary();
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    ELECTRON_RUN_AS_NODE: '1',
    ...(binary === null ? {} : { ESBUILD_BINARY_PATH: binary }),
  };
  // Either would let a module or a loader from outside the owned runtime into
  // the compiler, and nothing DROIDEX sets needs them: the compiler picks its
  // own loader through `execArgv`.
  delete env.NODE_PATH;
  delete env.NODE_OPTIONS;
  return env;
}

// The loader registers tsx and imports the TypeScript entry in development; the
// built sidecar forks the bundled entry beside it, as `HistoryWorkerClient`
// resolves its own worker.
function compilerEntryPath(): string {
  const name = import.meta.url.endsWith('.ts')
    ? './compilerWorkerLoader.mjs'
    : './compilerWorker.mjs';
  return fileURLToPath(new URL(name, import.meta.url));
}
