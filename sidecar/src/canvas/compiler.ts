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
import { canvasError } from './canvasError.js';
import type { CanvasDiagnostic, DesignSystemRef, ElementEdit, SourceElement } from './protocol.js';
import {
  CANVAS_LIMITS,
  sourceElementSchema,
  sourceFilesSchema,
  type SourceFiles,
} from './schema.js';

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
  /** Revision-scoped sites mapped to canonical source for selection and edits. */
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
  | {
      type: 'edit';
      requestId: number;
      files: SourceFiles;
      elements: SourceElement[];
      edit: ElementEdit;
      designSystem: DesignSystemRef;
    }
  | { type: 'cancel'; requestId: number }
  | { type: 'shutdown'; requestId: number };

type EditFailureCode = 'stale_reference' | 'ambiguous_element' | 'invalid_source' | 'invalid_edit';

export type CompilerResponse =
  | { requestId: number; status: 'ready'; design: CompiledDesign }
  | { requestId: number; status: 'edited'; files: SourceFiles }
  | { requestId: number; status: 'edit_failed'; code: EditFailureCode; message: string }
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

interface PendingEdit {
  resolve(files: SourceFiles): void;
  reject(error: Error): void;
  release(): void;
}

// The only two things a user can do about a compiler that cannot answer, and
// the only text safe to show: a worker's own failure carries module paths.
// `canvasBuildFailures.ts` picks between them by the reason, never by matching.
export const COMPILER_UNAVAILABLE = 'The Canvas compiler is unavailable; restart DROIDEX.';
export const RUNTIME_UNAVAILABLE =
  'The design compiler is not installed correctly. Reinstall DROIDEX.';

// How long a shutdown may take before the thread is ended anyway. This is
// cleanup, not the build deadline Task 3b owns.
const SHUTDOWN_GRACE_MS = 2_000;

export class CompilerWorker {
  private compiler: ChildProcess | null = null;
  private readonly pending = new Map<number, PendingCompile>();
  private readonly pendingEdits = new Map<number, PendingEdit>();
  private shutdownAck: (() => void) | null = null;
  private nextRequestId = 1;
  private terminated = false;

  /**
   * Compiles one revision. Rejects with `CompileFailedError` when the source is
   * wrong, `CompileCancelledError` when `signal` aborts, and
   * `CompilerUnavailableError` when the worker dies under the call.
   */
  compile(input: CompileInput, signal: AbortSignal): Promise<CompiledDesign> {
    if (this.terminated)
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

  /** Applies one literal edit in the parser-owning process. */
  edit(
    files: SourceFiles,
    elements: SourceElement[],
    edit: ElementEdit,
    designSystem: DesignSystemRef,
    signal: AbortSignal,
  ): Promise<SourceFiles> {
    if (this.terminated)
      return Promise.reject(new CompilerUnavailableError('lost-compiler', COMPILER_UNAVAILABLE));
    if (signal.aborted) return Promise.reject(new CompileCancelledError());
    const requestId = this.nextRequestId++;
    const compiler = this.liveCompiler();
    return new Promise<SourceFiles>((resolve, reject) => {
      const onAbort = (): void => {
        this.settleEdit(requestId, () => {
          reject(new CompileCancelledError());
        });
        compiler.send({ type: 'cancel', requestId } satisfies CompilerRequest);
      };
      signal.addEventListener('abort', onAbort, { once: true });
      this.pendingEdits.set(requestId, {
        resolve,
        reject,
        release: () => {
          signal.removeEventListener('abort', onAbort);
        },
      });
      compiler.send({
        type: 'edit',
        requestId,
        files,
        elements,
        edit,
        designSystem,
      } satisfies CompilerRequest);
    });
  }

  /** Final: every in-flight compile rejects and no later compile is accepted. */
  async terminate(): Promise<void> {
    if (this.terminated) return;
    this.terminated = true;
    const compiler = this.compiler;
    this.compiler = null;
    this.failAll(new CompilerUnavailableError('lost-compiler', COMPILER_UNAVAILABLE));
    if (!compiler) return;
    // The compiler owns esbuild's service process, so it gets the turn it needs
    // to stop that service while it can still reap it.
    await this.awaitShutdown(compiler);
    compiler.kill();
  }

  private awaitShutdown(compiler: ChildProcess): Promise<void> {
    return new Promise<void>((resolve) => {
      const finish = (): void => {
        clearTimeout(grace);
        this.shutdownAck = null;
        resolve();
      };
      const grace = setTimeout(finish, SHUTDOWN_GRACE_MS);
      grace.unref();
      this.shutdownAck = finish;
      // A compiler that is already gone cannot answer, and neither can one that
      // dies while stopping.
      compiler.once('exit', finish);
      compiler.once('error', finish);
      const requestId = this.nextRequestId++;
      compiler.send({ type: 'shutdown', requestId } satisfies CompilerRequest);
    });
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
    if (response.status === 'stopped') {
      this.shutdownAck?.();
      return;
    }
    if (this.pendingEdits.has(response.requestId)) {
      this.settleEdit(response.requestId, (call) => {
        switch (response.status) {
          case 'edited':
            call.resolve(response.files);
            return;
          case 'edit_failed':
            call.reject(canvasError(response.code, response.message));
            return;
          case 'cancelled':
            call.reject(new CompileCancelledError());
            return;
          case 'unavailable':
            call.reject(new CompilerUnavailableError(response.reason, response.message));
            return;
          default:
            call.reject(new CompilerUnavailableError('lost-compiler', COMPILER_UNAVAILABLE));
        }
      });
      return;
    }
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
        default:
          call.reject(new CompilerUnavailableError('lost-compiler', COMPILER_UNAVAILABLE));
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
    for (const requestId of [...this.pendingEdits.keys()])
      this.settleEdit(requestId, (call) => {
        call.reject(error);
      });
  }

  /** Settles a request exactly once; a later answer for it is dropped. */
  private settle(requestId: number, finish: (call: PendingCompile) => void): void {
    const call = this.pending.get(requestId);
    if (!call) return;
    this.pending.delete(requestId);
    call.release();
    finish(call);
  }

  private settleEdit(requestId: number, finish: (call: PendingEdit) => void): void {
    const call = this.pendingEdits.get(requestId);
    if (!call) return;
    this.pendingEdits.delete(requestId);
    call.release();
    finish(call);
  }
}

const UNAVAILABLE_REASONS: readonly CompilerUnavailableReason[] = [
  'damaged-runtime',
  'lost-compiler',
];
const EDIT_FAILURE_CODES: readonly EditFailureCode[] = [
  'stale_reference',
  'ambiguous_element',
  'invalid_source',
  'invalid_edit',
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
    files,
    code,
  } = message as Record<string, unknown>;
  if (typeof requestId !== 'number') return null;
  const edit = editResponse(requestId, status, files, code, text);
  if (edit !== undefined) return edit;
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

function editResponse(
  requestId: number,
  status: unknown,
  files: unknown,
  code: unknown,
  message: unknown,
): Extract<CompilerResponse, { status: 'edited' | 'edit_failed' }> | null | undefined {
  if (status === 'edited') {
    const parsed = sourceFilesSchema.safeParse(files);
    return parsed.success ? { requestId, status, files: parsed.data } : null;
  }
  if (status === 'edit_failed')
    return typeof message === 'string' && EDIT_FAILURE_CODES.includes(code as EditFailureCode)
      ? { requestId, status, code: code as EditFailureCode, message }
      : null;
  return undefined;
}

function isCompiledDesign(design: unknown): design is CompiledDesign {
  if (typeof design !== 'object' || design === null) return false;
  const { artifactId, html, diagnostics, elements } = design as Record<string, unknown>;
  return (
    typeof artifactId === 'string' &&
    typeof html === 'string' &&
    Array.isArray(diagnostics) &&
    Array.isArray(elements) &&
    elements.length <= CANVAS_LIMITS.maxSourceElements &&
    elements.every((element) => sourceElementSchema.safeParse(element).success)
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
  delete env.CANVAS_EXPORT_TOKEN;
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
