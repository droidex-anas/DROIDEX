// The `codex app-server` stdio transport: one JSON object per line, in
// JSON-RPC's envelope shapes but without its `jsonrpc` field. Owns the framing,
// request correlation and the lifetime of the one process it speaks to.
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';

import { errMsg } from '../../sessionHelpers.js';

// A line this long is a runaway payload rather than a message: fail the client
// instead of buffering until the sidecar runs out of memory. The bound has to
// clear a generated image, which Codex sends base64-encoded inside its
// completion item (a 1.4 MB photo arrives as a 1.8 MB line).
const MAX_LINE_BYTES = 64 * 1024 * 1024;
const METHOD_NOT_FOUND = -32601;
const HANDLER_FAILED = -32603;
// How long a closing process gets at each step before the next signal.
const EXIT_GRACE_MS = 500;
// Enough of the CLI's own diagnostics to explain why it exited.
const STDERR_TAIL_CHARS = 2_000;

type JsonRpcId = number | string;

interface WireMessage {
  id?: JsonRpcId;
  method?: string;
  params?: unknown;
  result?: unknown;
  error?: { code: number; message: string };
}

interface PendingRequest {
  resolve: (result: unknown) => void;
  reject: (error: Error) => void;
}

export class AppServerClient {
  private readonly child: ChildProcessWithoutNullStreams;
  private readonly pending = new Map<number, PendingRequest>();
  private readonly notificationHandlers = new Map<string, (params: unknown) => void>();
  private readonly requestHandlers = new Map<string, (params: unknown) => Promise<unknown>>();
  private closed?: (error: Error, cleanExit: boolean) => void;
  // Whether the process ended on its own terms rather than dying.
  private cleanExit = false;
  private unsupportedRequest?: (method: string, params: unknown) => void;
  private remainder = '';
  private diagnostics = '';
  private nextRequestId = 1;
  private failure?: Error;

  // The environment is inherited as-is: Codex reads its own home, login and
  // config from it, and a relocated home would report the user as signed out.
  constructor(executable: string, cwd: string) {
    this.child = spawn(executable, ['app-server'], { cwd, stdio: ['pipe', 'pipe', 'pipe'] });
    this.child.stdout.setEncoding('utf8');
    this.child.stderr.setEncoding('utf8');
    this.child.stdout.on('data', (chunk: string) => {
      this.receive(chunk);
    });
    this.child.stderr.on('data', (chunk: string) => {
      this.diagnostics = (this.diagnostics + chunk).slice(-STDERR_TAIL_CHARS);
    });
    // The last line may arrive without its terminator; deliver it before the
    // exit that follows fails everything still pending.
    this.child.stdout.on('end', () => {
      this.receive('\n');
    });
    this.child.stdin.on('error', (error: Error) => {
      this.fail(error);
    });
    this.child.on('error', (error: Error) => {
      this.fail(error);
    });
    this.child.on('close', (code, signal) => {
      // Every pending request still has to reject, but a process that ended on
      // its own terms is not something the chat should record as a crash.
      this.cleanExit = !signal && (code ?? 0) === 0;
      this.fail(new Error(this.exitMessage(code, signal)));
    });
  }

  get pid(): number | undefined {
    return this.child.pid;
  }

  isAlive(): boolean {
    return this.child.exitCode === null && this.child.signalCode === null;
  }

  // Handlers are registered before `initialize` so a server request or
  // notification can never arrive before its dispatch entry exists.
  onNotification(method: string, handler: (params: unknown) => void): void {
    this.notificationHandlers.set(method, handler);
  }

  onRequest(method: string, handler: (params: unknown) => Promise<unknown>): void {
    this.requestHandlers.set(method, handler);
  }

  // Told about a request this build refuses, so the refusal can be reported
  // rather than leaving Codex to stop for a reason nobody can see.
  onUnsupportedRequest(listener: (method: string, params: unknown) => void): void {
    this.unsupportedRequest = listener;
  }

  // Called once when the process is gone, so a turn waiting on notifications
  // fails instead of hanging. Fires immediately if it is already gone.
  onClose(listener: (error: Error, cleanExit: boolean) => void): void {
    this.closed = listener;
    if (this.failure) this.settle(this.failure);
  }

  request<T>(method: string, params: unknown): Promise<T> {
    if (this.failure) return Promise.reject(this.failure);
    const id = this.nextRequestId++;
    return new Promise<T>((resolve, reject) => {
      // Registered before the write, so a response cannot arrive unclaimed.
      this.pending.set(id, { resolve: resolve as (result: unknown) => void, reject });
      this.write({ id, method, params });
    });
  }

  notify(method: string, params?: unknown): void {
    this.write(params === undefined ? { method } : { method, params });
  }

  async close(): Promise<void> {
    this.fail(new Error('The Codex session was closed.'));
    if (!this.isAlive()) return;
    this.child.stdin.end();
    if (await this.exits()) return;
    this.child.kill('SIGTERM');
    if (await this.exits()) return;
    this.child.kill('SIGKILL');
    // Returning before the process is reaped would let a caller delete the
    // working directory out from under it.
    await this.exits();
  }

  private receive(chunk: string): void {
    this.remainder += chunk;
    let newline = this.remainder.indexOf('\n');
    while (newline >= 0) {
      const line = this.remainder.slice(0, newline).replace(/\r$/, '');
      this.remainder = this.remainder.slice(newline + 1);
      if (this.tooLong(line)) return;
      if (line) this.dispatch(line);
      newline = this.remainder.indexOf('\n');
    }
    this.tooLong(this.remainder);
  }

  // Applies to a complete line as well as to the unterminated tail: either way
  // it is a runaway payload, not a message.
  private tooLong(text: string): boolean {
    if (Buffer.byteLength(text) <= MAX_LINE_BYTES) return false;
    this.remainder = '';
    this.fail(new Error('Codex sent a line larger than 64 MiB; the session was ended.'));
    this.child.kill('SIGKILL');
    return true;
  }

  // Drained straight into the handlers: a queue between the process and the
  // transcript would drop streaming deltas the moment a turn outpaces it.
  private dispatch(line: string): void {
    const message = wireMessage(line);
    if (!message) {
      this.fail(new Error('Codex sent a line that is not a message; the session was ended.'));
      this.child.kill('SIGKILL');
      return;
    }
    if (message.method !== undefined && message.id !== undefined) {
      void this.serve(message.id, message.method, message.params);
      return;
    }
    if (message.method !== undefined) {
      // An unhandled notification is one of the many this adapter has no use
      // for; the handled set is the mapper's own list.
      this.notificationHandlers.get(message.method)?.(message.params);
      return;
    }
    if (typeof message.id !== 'number') return;
    const pending = this.pending.get(message.id);
    if (!pending) return;
    this.pending.delete(message.id);
    if (message.error) pending.reject(new Error(message.error.message));
    else pending.resolve(message.result);
  }

  // Fails closed: a request this build does not implement is answered with
  // method-not-found, never with a grant.
  private async serve(id: JsonRpcId, method: string, params: unknown): Promise<void> {
    const handler = this.requestHandlers.get(method);
    if (!handler) {
      this.unsupportedRequest?.(method, params);
      this.write({ id, error: { code: METHOD_NOT_FOUND, message: `Unsupported: ${method}` } });
      return;
    }
    try {
      this.write({ id, result: await handler(params) });
    } catch (error) {
      this.write({ id, error: { code: HANDLER_FAILED, message: errMsg(error) } });
    }
  }

  private write(message: WireMessage): void {
    if (this.failure) return;
    this.child.stdin.write(`${JSON.stringify(message)}\n`);
  }

  private fail(error: Error): void {
    if (this.failure) return;
    this.failure = error;
    for (const pending of this.pending.values()) pending.reject(error);
    this.pending.clear();
    this.settle(error);
  }

  private settle(error: Error): void {
    const listener = this.closed;
    this.closed = undefined;
    listener?.(error, this.cleanExit);
  }

  private exitMessage(code: number | null, signal: NodeJS.Signals | null): string {
    const ended = signal ? `was killed (${signal})` : `exited with code ${String(code ?? 0)}`;
    const detail = this.diagnostics.trim();
    return detail ? `Codex ${ended}: ${detail}` : `Codex ${ended}.`;
  }

  private exits(): Promise<boolean> {
    return new Promise((resolve) => {
      if (!this.isAlive()) {
        resolve(true);
        return;
      }
      const timer = setTimeout(() => {
        resolve(false);
      }, EXIT_GRACE_MS);
      this.child.once('close', () => {
        clearTimeout(timer);
        resolve(true);
      });
    });
  }
}

// The three envelopes this protocol has: a request (a method and an id), a
// notification (a method and no id) and a response (an id and exactly one of
// result or error). Anything else — `null`, a bare number, `{}`, a lone id —
// is not a message, and reading protocol fields off one would either throw out
// of the stdout listener or settle a pending request with nothing.
function wireMessage(line: string): WireMessage | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(line);
  } catch {
    return undefined;
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return undefined;
  const message = parsed as WireMessage;
  const identified = typeof message.id === 'string' || typeof message.id === 'number';
  if (typeof message.method === 'string')
    return 'id' in message && !identified ? undefined : message;
  if (!identified) return undefined;
  return 'result' in message !== 'error' in message ? message : undefined;
}
