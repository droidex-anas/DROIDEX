import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { Writable } from 'node:stream';
import {
  ClientApp,
  ndJsonStream,
  type AuthMethod,
  type ClientConnection,
  type InitializeResponse,
  type RequestPermissionRequest,
  type RequestPermissionResponse,
  type SessionNotification,
} from '@agentclientprotocol/sdk/unstable';
import { childEnv } from '../../childEnv.js';
import { readDevinApiKey } from './devinCredentials.js';
import type { DevinTerminals } from './devinTerminals.js';

export class DevinClient {
  readonly connection: ClientConnection;
  readonly closed: Promise<Error | undefined>;
  private readonly child: ChildProcessWithoutNullStreams;
  private stderr = '';
  private stopping = false;
  private failure?: Error;
  private settle!: (error: Error | undefined) => void;
  private stopPromise?: Promise<void>;
  isClosed = false;

  constructor(
    executable: string,
    cwd: string,
    handlers: {
      update: (notification: SessionNotification) => void;
      permission: (request: RequestPermissionRequest) => Promise<RequestPermissionResponse>;
      terminals: DevinTerminals;
    },
  ) {
    this.closed = new Promise((resolve) => {
      this.settle = resolve;
    });
    this.child = spawn(executable, ['acp'], { cwd, env: childEnv(), stdio: 'pipe' });
    this.child.stderr.setEncoding('utf8').on('data', (chunk: string) => {
      this.stderr = (this.stderr + chunk).slice(-4096);
    });
    const output = this.child.stdout[Symbol.asyncIterator]();
    const readable = new ReadableStream<Uint8Array>({
      async pull(controller) {
        const chunk = await output.next();
        if (chunk.done) controller.close();
        else controller.enqueue(new Uint8Array(chunk.value));
      },
      async cancel() {
        await output.return?.();
      },
    });
    this.connection = new ClientApp()
      .onNotification('session/update', ({ params }) => {
        handlers.update(params);
      })
      .onRequest('session/request_permission', ({ params }) => handlers.permission(params))
      .onRequest('terminal/create', ({ params }) => handlers.terminals.create(params))
      .onRequest('terminal/output', ({ params }) => handlers.terminals.output(params))
      .onRequest('terminal/wait_for_exit', ({ params }) => handlers.terminals.waitForExit(params))
      .onRequest('terminal/kill', ({ params }) => handlers.terminals.kill(params))
      .onRequest('terminal/release', ({ params }) => handlers.terminals.release(params))
      .connect(ndJsonStream(Writable.toWeb(this.child.stdin), readable));
    this.child.on('error', (error) => {
      this.finish(error);
    });
    const exited = (code: number | null, signal: NodeJS.Signals | null) => {
      this.finish(
        this.stopping
          ? undefined
          : new Error(
              `Devin exited (${signal ?? String(code)}).${this.stderr.trim() ? ` ${this.stderr.trim()}` : ''}`,
            ),
      );
    };
    // A descendant that inherited stdout or stderr can hold 'close' back for its
    // whole life; give the pipes a moment to drain, then settle on the exit.
    let drain: NodeJS.Timeout | undefined;
    this.child.on('exit', (code, signal) => {
      drain = setTimeout(() => {
        exited(code, signal);
      }, 500);
      drain.unref();
    });
    this.child.on('close', (code, signal) => {
      clearTimeout(drain);
      exited(code, signal);
    });
    void this.connection.closed.then(() => {
      if (!this.stopping && !this.isClosed) this.child.kill('SIGKILL');
    });
  }

  get process(): { pid: number; isAlive(): boolean } | undefined {
    const pid = this.child.pid;
    return pid === undefined ? undefined : { pid, isAlive: () => !this.isClosed };
  }

  initialize(signal?: AbortSignal): Promise<InitializeResponse> {
    return this.connection.agent.request(
      'initialize',
      {
        protocolVersion: 1,
        clientInfo: { name: 'droidex', version: '1.0.0' },
        clientCapabilities: {
          terminal: true,
          _meta: { 'cognition.ai/messageGrouping': true, 'cognition.ai/subagentSupport': true },
        },
      },
      signal ? { cancellationSignal: signal, stopWaitingOnCancel: true } : undefined,
    );
  }

  async authenticate(
    authMethods: readonly AuthMethod[] | undefined,
    signal?: AbortSignal,
  ): Promise<void> {
    const method = authMethods?.find((method) => !('type' in method));
    if (!method)
      throw new Error(
        'Devin requires interactive terminal authentication. Run devin auth login, then retry.',
      );
    // Without the stored login this method opens a browser from a background process.
    const apiKey = await readDevinApiKey();
    if (!apiKey) throw new Error('Devin is signed out. Run devin auth login, then retry.');
    await this.connection.agent.request(
      'authenticate',
      { methodId: method.id, _meta: { api_key: apiKey } },
      signal ? { cancellationSignal: signal, stopWaitingOnCancel: true } : undefined,
    );
  }

  async diagnostic(error: unknown): Promise<Error> {
    if (this.connection.signal.aborted && !this.isClosed) await this.closed;
    return this.failure ?? (error instanceof Error ? error : new Error(String(error)));
  }

  stop(): Promise<void> {
    if (this.stopPromise) return this.stopPromise;
    this.stopping = true;
    this.connection.close();
    this.stopPromise = (async () => {
      if (this.isClosed) return;
      this.child.kill();
      const timer = setTimeout(() => this.child.kill('SIGKILL'), 1000);
      try {
        await this.closed;
      } finally {
        clearTimeout(timer);
      }
    })();
    return this.stopPromise;
  }

  private finish(error: Error | undefined): void {
    if (this.isClosed) return;
    this.isClosed = true;
    this.failure = error;
    this.connection.close(error);
    this.settle(error);
  }
}
