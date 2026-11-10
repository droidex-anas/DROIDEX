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
import { terminateCompilerProcess } from './canvasCompilerExit.js';
import { ownedEsbuildBinary } from './canvasRuntime.js';
import { canvasError, storageFailure } from './canvasError.js';
import { moduleDeclarationsSchema, type ModuleDeclarations } from './compilerModules.js';
import type { DesignSystem } from './designSystems.js';
import type {
  CanvasDiagnostic,
  DesignSystemAdherence,
  DesignSystemRef,
  ElementEdit,
  SourceElement,
  SourceOutline,
} from './protocol.js';
import {
  CANVAS_LIMITS,
  sourceElementSchema,
  sourceFilesSchema,
  sourceOutlineSchema,
  type SourceFiles,
} from './schema.js';

/** One frame revision's compile. */
export interface DesignCompileInput {
  kind: 'design';
  designId: string;
  revisionId: string;
  /** The owning lifecycle generation, carried back so a result can be pinned. */
  generation: number;
  files: SourceFiles;
  designSystem: DesignSystemRef;
  /** The canvas's rule at the time the build started. */
  designSystemAdherence: DesignSystemAdherence;
}

/** One example under a kit, saved or not: no revision to select in, no kit to be held to. */
export interface KitPreviewCompileInput {
  kind: 'kitPreview';
  kit: Pick<DesignSystem, 'files' | 'sections'>;
  mode: DesignSystemRef['mode'];
  /** The example's source, compiled as the entry of a one-file design. */
  example: string;
}

export type CompileInput = DesignCompileInput | KitPreviewCompileInput;

export interface CompiledDesign {
  /** sha256 of `html`, so identical input names one artifact. */
  artifactId: string;
  /** A self-contained preview document: inline stylesheet, inline bundle. */
  html: string;
  /** Warnings that accompany a usable artifact; errors arrive as a rejection. */
  diagnostics: CanvasDiagnostic[];
  /** Revision-scoped sites mapped to canonical source for selection and edits. */
  elements: SourceElement[];
  /** What the design's root renders, as written, for the layers panel. */
  outline: SourceOutline;
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
  | { type: 'readModules'; requestId: number; sources: string[] }
  | { type: 'cancel'; requestId: number }
  | { type: 'shutdown'; requestId: number };

type EditFailureCode =
  | 'stale_reference'
  | 'ambiguous_element'
  | 'invalid_source'
  | 'invalid_edit'
  | 'unsupported_edit';

export type CompilerResponse =
  | { requestId: number; status: 'ready'; design: CompiledDesign }
  | { requestId: number; status: 'edited'; files: SourceFiles }
  | { requestId: number; status: 'edit_failed'; code: EditFailureCode; message: string }
  | { requestId: number; status: 'modules'; modules: ModuleDeclarations[] }
  | { requestId: number; status: 'failed'; diagnostics: CanvasDiagnostic[] }
  | { requestId: number; status: 'cancelled' }
  | {
      requestId: number;
      status: 'unavailable';
      reason: CompilerUnavailableReason;
      message: string;
    }
  | { requestId: number; status: 'stopped' };

interface PendingRequest {
  /** Answers the caller from the compiler's reply to this request. */
  answer(response: CompilerResponse): void;
  reject(error: Error): void;
  release(): void;
}

/** A request's own answer from a reply, or undefined for one every request shares. */
type ReadReply<T> = (response: CompilerResponse) => T | Error | undefined;

// The only two things a user can do about a compiler that cannot answer, and
// the only text safe to show: a worker's own failure carries module paths.
// `canvasBuildFailures.ts` picks between them by the reason, never by matching.
export const COMPILER_UNAVAILABLE = 'The Canvas compiler is unavailable; restart DROIDEX.';
export const RUNTIME_UNAVAILABLE =
  'The design compiler is not installed correctly. Reinstall DROIDEX.';

export class CompilerWorker {
  private compiler: ChildProcess | null = null;
  private readonly pending = new Map<number, PendingRequest>();
  private retiring: Promise<void> | null = null;
  private termination: Promise<void> | null = null;
  private nextRequestId = 1;

  /**
   * Compiles one revision. Rejects with `CompileFailedError` when the source is
   * wrong, `CompileCancelledError` when `signal` aborts, and
   * `CompilerUnavailableError` when the worker dies under the call.
   */
  compile(input: CompileInput, signal: AbortSignal): Promise<CompiledDesign> {
    return this.request<CompiledDesign>(
      signal,
      (requestId) => ({ type: 'compile', requestId, input }),
      (response) => {
        if (response.status === 'ready') return response.design;
        if (response.status === 'failed') return new CompileFailedError(response.diagnostics);
        return undefined;
      },
    );
  }

  /** Applies one literal edit in the parser-owning process. */
  edit(
    files: SourceFiles,
    elements: SourceElement[],
    edit: ElementEdit,
    designSystem: DesignSystemRef,
    signal: AbortSignal,
  ): Promise<SourceFiles> {
    return this.request<SourceFiles>(
      signal,
      (requestId) => ({ type: 'edit', requestId, files, elements, edit, designSystem }),
      (response) => {
        if (response.status === 'edited') return response.files;
        if (response.status === 'edit_failed') return canvasError(response.code, response.message);
        return undefined;
      },
    );
  }

  /** What each of `sources` imports and exports, read by the parser-owning process. */
  readModules(sources: string[], signal: AbortSignal): Promise<ModuleDeclarations[]> {
    return this.request(
      signal,
      (requestId) => ({ type: 'readModules', requestId, sources }),
      (response) => (response.status === 'modules' ? response.modules : undefined),
    );
  }

  /** Final: rejects all requests, refuses new ones, and awaits the owned child's exit. */
  terminate(): Promise<void> {
    if (this.termination !== null) return this.termination;
    const compiler = this.compiler;
    this.compiler = null;
    this.termination =
      this.retiring ??
      (compiler === null
        ? Promise.resolve()
        : terminateCompilerProcess(compiler, this.nextRequestId++));
    this.failAll(new CompilerUnavailableError('lost-compiler', COMPILER_UNAVAILABLE));
    return this.termination;
  }

  private request<T>(
    signal: AbortSignal,
    message: (requestId: number) => CompilerRequest,
    read: ReadReply<T>,
  ): Promise<T> {
    if (this.termination !== null)
      return Promise.reject(new CompilerUnavailableError('lost-compiler', COMPILER_UNAVAILABLE));
    if (signal.aborted) return Promise.reject(new CompileCancelledError());
    if (this.retiring !== null)
      return this.retiring.then(() => this.request(signal, message, read));

    const requestId = this.nextRequestId++;
    const compiler = this.liveCompiler();
    return new Promise<T>((resolve, reject) => {
      const onAbort = (): void => {
        // The compiler checks its own signal between stages, but the caller is
        // answered now rather than waiting for work it no longer wants.
        this.settle(requestId, () => {
          reject(new CompileCancelledError());
        });
        compiler.send({ type: 'cancel', requestId } satisfies CompilerRequest);
      };
      signal.addEventListener('abort', onAbort, { once: true });
      this.pending.set(requestId, {
        answer: (response) => {
          const answer = read(response);
          if (answer === undefined) reject(sharedOutcome(response));
          else if (answer instanceof Error) reject(answer);
          else resolve(answer);
        },
        reject,
        release: () => {
          signal.removeEventListener('abort', onAbort);
        },
      });
      compiler.send(message(requestId));
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
        return;
      }
      if (response.status === 'stopped') return;
      this.settle(response.requestId, (call) => {
        call.answer(response);
      });
    });
    compiler.on('error', (error: Error) => {
      this.loseCompiler(compiler, error);
    });
    compiler.on('exit', (code) => {
      if (this.compiler !== compiler || this.retiring !== null) return;
      this.compiler = null;
      console.error(
        'Canvas compiler lost:',
        new Error(`The compiler exited with code ${String(code)}.`),
      );
      this.failAll(new CompilerUnavailableError('lost-compiler', COMPILER_UNAVAILABLE));
    });
    this.compiler = compiler;
    return compiler;
  }

  /** The cause goes to the sidecar log; the caller learns only what to do. */
  private loseCompiler(compiler: ChildProcess, cause: Error): void {
    if (this.compiler !== compiler || this.retiring !== null) return;
    console.error('Canvas compiler lost:', cause);
    const ending = terminateCompilerProcess(compiler, this.nextRequestId++);
    this.retiring = ending;
    this.failAll(new CompilerUnavailableError('lost-compiler', COMPILER_UNAVAILABLE));
    void ending.then(() => {
      if (this.compiler === compiler) this.compiler = null;
      if (this.retiring === ending) this.retiring = null;
    });
  }

  private failAll(error: Error): void {
    for (const requestId of [...this.pending.keys()]) {
      this.settle(requestId, (call) => {
        call.reject(error);
      });
    }
  }

  /** Settles a request exactly once; a later answer for it is dropped. */
  private settle(requestId: number, finish: (call: PendingRequest) => void): void {
    const call = this.pending.get(requestId);
    if (!call) return;
    this.pending.delete(requestId);
    call.release();
    finish(call);
  }
}

/** What each of `sources` imports and exports, read in a compiler process that ends with the read. */
export async function readModules(
  sources: string[],
  signal?: AbortSignal,
): Promise<ModuleDeclarations[]> {
  const compiler = new CompilerWorker();
  try {
    return await compiler.readModules(sources, signal ?? new AbortController().signal);
  } catch (error) {
    signal?.throwIfAborted();
    if (error instanceof CompilerUnavailableError) throw storageFailure(error.message, error);
    throw error;
  } finally {
    await compiler.terminate();
  }
}

/** What a cancelled or unavailable reply means to any request, and any other reply to this one. */
function sharedOutcome(response: CompilerResponse): Error {
  if (response.status === 'cancelled') return new CompileCancelledError();
  // Already a curated recovery message from the sidecar's own storage
  // boundary, which never carries a path (spec §8).
  if (response.status === 'unavailable')
    return new CompilerUnavailableError(response.reason, response.message);
  return new CompilerUnavailableError('lost-compiler', COMPILER_UNAVAILABLE);
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
  'unsupported_edit',
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
  const fields = message as Record<string, unknown>;
  const { requestId, status, reason, message: text, design, diagnostics } = fields;
  if (typeof requestId !== 'number') return null;
  const edit = editResponse(requestId, fields);
  if (edit !== undefined) return edit;
  if (status === 'modules') return modulesResponse(requestId, fields.modules);
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
  { status, files, code, message }: Record<string, unknown>,
): Extract<CompilerResponse, { status: 'edited' | 'edit_failed' }> | null | undefined {
  if (status === 'edited') {
    const parsedFiles = sourceFilesSchema.safeParse(files);
    return parsedFiles.success ? { requestId, status, files: parsedFiles.data } : null;
  }
  if (status === 'edit_failed')
    return typeof message === 'string' && EDIT_FAILURE_CODES.includes(code as EditFailureCode)
      ? { requestId, status, code: code as EditFailureCode, message }
      : null;
  return undefined;
}

function modulesResponse(
  requestId: number,
  modules: unknown,
): Extract<CompilerResponse, { status: 'modules' }> | null {
  const parsed = moduleDeclarationsSchema.array().safeParse(modules);
  return parsed.success ? { requestId, status: 'modules', modules: parsed.data } : null;
}

function isCompiledDesign(design: unknown): design is CompiledDesign {
  if (typeof design !== 'object' || design === null) return false;
  const { artifactId, html, diagnostics, elements, outline } = design as Record<string, unknown>;
  return (
    typeof artifactId === 'string' &&
    typeof html === 'string' &&
    Array.isArray(diagnostics) &&
    Array.isArray(elements) &&
    elements.length <= CANVAS_LIMITS.maxSourceElements &&
    elements.every((element) => sourceElementSchema.safeParse(element).success) &&
    sourceOutlineSchema.safeParse(outline).success
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
