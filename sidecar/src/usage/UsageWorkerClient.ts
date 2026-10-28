import { MessageChannel, Worker, type MessagePort, type WorkerOptions } from 'node:worker_threads';

import {
  type UsageWorkerData,
  type UsageWorkerEnvelope,
  type UsageWorkerReconcileResult,
  type UsageWorkerRequest,
  type UsageWorkerResponse,
  type UsageWorkerSnapshot,
  type UsageWorkerValue,
  usageWorkerError,
} from './UsageWorkerProtocol.js';

const DEFAULT_TIMEOUT_MS = 30_000;

export interface UsageWorkerClientOptions {
  worker?: Worker;
  workerData?: UsageWorkerData;
  workerUrl?: URL;
  timeoutMs?: number;
  onError?: (error: Error) => void;
}

export class UsageWorkerClient {
  private readonly worker: Worker;
  private readonly timeoutMs: number;
  private readonly onError: (error: Error) => void;
  private readonly active = new Set<{ fail(error: Error): void }>();
  private failure: Error | null = null;
  private closed = false;
  private closing: Promise<void> | null = null;

  constructor(options: UsageWorkerClientOptions = {}) {
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.onError = options.onError ?? (() => undefined);
    if (!Number.isSafeInteger(this.timeoutMs) || this.timeoutMs <= 0) {
      throw new Error('Usage worker timeout must be a positive integer.');
    }
    const workerOptions: WorkerOptions = { workerData: options.workerData, execArgv: [] };
    this.worker =
      options.worker ?? new Worker(options.workerUrl ?? defaultWorkerUrl(), workerOptions);
    this.worker.on('error', (error) => {
      this.fail(error);
    });
    this.worker.on('exit', (code) => {
      if (!this.closed) this.fail(new Error(`Usage worker exited with code ${String(code)}.`));
    });
  }

  async snapshot(): Promise<UsageWorkerSnapshot> {
    return await this.call<UsageWorkerSnapshot>({ type: 'snapshot' });
  }

  async reconcile(): Promise<UsageWorkerReconcileResult> {
    return await this.call<UsageWorkerReconcileResult>({ type: 'reconcile' });
  }

  async recordDroidexSessions(ids: readonly string[]): Promise<{ insertedSessions: number }> {
    return await this.call<{ insertedSessions: number }>({
      type: 'record-droidex-sessions',
      ids: [...ids],
    });
  }

  close(): Promise<void> {
    this.closing ??= this.performClose();
    return this.closing;
  }

  private async performClose(): Promise<void> {
    let closeError: Error | undefined;
    if (!this.failure) {
      try {
        await this.call<{ closed: true }>({ type: 'close' });
      } catch (error) {
        closeError = asError(error);
      }
    }
    this.closed = true;
    const terminal = this.failure ?? new Error('Usage worker is closed.');
    for (const call of this.active) call.fail(terminal);
    this.active.clear();
    await this.worker.terminate();
    if (closeError) throw closeError;
  }

  private call<T extends UsageWorkerValue>(request: UsageWorkerRequest): Promise<T> {
    if (this.closed || (this.closing && request.type !== 'close')) {
      return Promise.reject(new Error('Usage worker is closed.'));
    }
    if (this.failure) return Promise.reject(this.failure);
    const channel = new MessageChannel();
    const call = new UsageWorkerCall<T>(channel.port1, this.timeoutMs, () => {
      this.active.delete(call);
    });
    this.active.add(call);
    const envelope: UsageWorkerEnvelope = { request, replyPort: channel.port2 };
    try {
      this.worker.postMessage(envelope, [channel.port2]);
    } catch (error) {
      const failure = asError(error);
      call.fail(failure);
      channel.port2.close();
      this.fail(failure);
    }
    return call.promise;
  }

  private fail(error: Error): void {
    if (this.failure || this.closed) return;
    this.failure = error;
    this.onError(error);
    for (const call of this.active) call.fail(error);
    this.active.clear();
  }
}

class UsageWorkerCall<T extends UsageWorkerValue> {
  readonly promise: Promise<T>;
  private settled = false;
  private resolvePromise: ((value: T) => void) | undefined;
  private rejectPromise: ((error: Error) => void) | undefined;
  private readonly watchdog: ReturnType<typeof setTimeout>;

  constructor(
    private readonly port: MessagePort,
    timeoutMs: number,
    private readonly onSettled: () => void,
  ) {
    this.promise = new Promise<T>((resolve, reject) => {
      this.resolvePromise = resolve;
      this.rejectPromise = reject;
    });
    this.watchdog = setTimeout(() => {
      this.fail(new Error(`Usage worker did not respond within ${String(timeoutMs)}ms.`));
    }, timeoutMs);
    this.watchdog.unref();
    port.on('message', (response: UsageWorkerResponse) => {
      this.settle(response);
    });
    port.on('messageerror', () => {
      this.fail(new Error('Usage worker returned an invalid message.'));
    });
    port.start();
  }

  fail(error: Error): void {
    if (this.settled) return;
    this.settled = true;
    this.rejectPromise?.(error);
    this.dispose();
  }

  private settle(response: UsageWorkerResponse): void {
    if (this.settled) return;
    if (!response.ok) {
      this.fail(usageWorkerError(response));
      return;
    }
    this.settled = true;
    this.resolvePromise?.(response.value as T);
    this.dispose();
  }

  private dispose(): void {
    clearTimeout(this.watchdog);
    this.resolvePromise = undefined;
    this.rejectPromise = undefined;
    this.port.removeAllListeners();
    this.port.close();
    this.onSettled();
  }
}

function defaultWorkerUrl(): URL {
  return new URL(
    import.meta.url.endsWith('.ts') ? './usageWorkerLoader.mjs' : './usageWorker.mjs',
    import.meta.url,
  );
}

function asError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}
