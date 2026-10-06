// The sidecar's half of the design compiler: one worker thread, one request per
// message, nothing else. Slots, per-design coalescing and build deadlines
// belong to `CanvasBuilds` (Task 3b), which owns this client.

import { Worker } from 'node:worker_threads';
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

/** The worker died or was terminated; the compile reached no conclusion. */
export class CompilerUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CompilerUnavailableError';
  }
}

export type CompilerRequest =
  | { type: 'compile'; requestId: number; input: CompileInput }
  | { type: 'cancel'; requestId: number };

export type CompilerResponse =
  | { requestId: number; status: 'ready'; design: CompiledDesign }
  | { requestId: number; status: 'failed'; diagnostics: CanvasDiagnostic[] }
  | { requestId: number; status: 'cancelled' }
  | { requestId: number; status: 'unavailable'; message: string };

interface PendingCompile {
  resolve(design: CompiledDesign): void;
  reject(error: Error): void;
  release(): void;
}

const TERMINATED = 'The design compiler was shut down.';

export class CompilerWorker {
  private worker: Worker | null = null;
  private readonly pending = new Map<number, PendingCompile>();
  private nextRequestId = 1;
  private terminated = false;

  /**
   * Compiles one revision. Rejects with `CompileFailedError` when the source is
   * wrong, `CompileCancelledError` when `signal` aborts, and
   * `CompilerUnavailableError` when the worker dies under the call.
   */
  compile(input: CompileInput, signal: AbortSignal): Promise<CompiledDesign> {
    if (this.terminated) return Promise.reject(new CompilerUnavailableError(TERMINATED));
    if (signal.aborted) return Promise.reject(new CompileCancelledError());

    const requestId = this.nextRequestId++;
    const worker = this.liveWorker();
    return new Promise<CompiledDesign>((resolve, reject) => {
      const onAbort = (): void => {
        // The worker checks its own signal between stages, but the caller is
        // answered now rather than waiting for a compile it no longer wants.
        this.settle(requestId, () => {
          reject(new CompileCancelledError());
        });
        worker.postMessage({ type: 'cancel', requestId } satisfies CompilerRequest);
      };
      signal.addEventListener('abort', onAbort, { once: true });
      this.pending.set(requestId, {
        resolve,
        reject,
        release: () => {
          signal.removeEventListener('abort', onAbort);
        },
      });
      worker.postMessage({ type: 'compile', requestId, input } satisfies CompilerRequest);
    });
  }

  /** Final: every in-flight compile rejects and no later compile is accepted. */
  async terminate(): Promise<void> {
    if (this.terminated) return;
    this.terminated = true;
    const worker = this.worker;
    this.worker = null;
    this.failAll(new CompilerUnavailableError(TERMINATED));
    // The worker's esbuild service child exits when the terminated thread's
    // handles close, so nothing else owns its lifetime.
    await worker?.terminate();
  }

  /**
   * The running worker, started on first use and replaced after a crash so one
   * bad revision cannot disable the compiler for the session.
   */
  private liveWorker(): Worker {
    if (this.worker) return this.worker;
    const worker = new Worker(compilerWorkerUrl(), { execArgv: [] });
    worker.on('message', (response: CompilerResponse) => {
      this.receive(response);
    });
    worker.on('error', (error: Error) => {
      this.loseWorker(worker, `The design compiler failed: ${error.message}`);
    });
    worker.on('exit', (code) => {
      this.loseWorker(worker, `The design compiler stopped with code ${String(code)}.`);
    });
    this.worker = worker;
    return worker;
  }

  private receive(response: CompilerResponse): void {
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
          call.reject(new CompilerUnavailableError(response.message));
          return;
      }
    });
  }

  private loseWorker(worker: Worker, message: string): void {
    if (this.worker !== worker) return;
    this.worker = null;
    this.failAll(new CompilerUnavailableError(message));
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

// tsx loads the TypeScript entry in development; the built sidecar loads the
// bundled worker beside it, as `HistoryWorkerClient` does.
function compilerWorkerUrl(): URL {
  const name = import.meta.url.endsWith('.ts')
    ? './compilerWorkerLoader.mjs'
    : './compilerWorker.mjs';
  return new URL(name, import.meta.url);
}
