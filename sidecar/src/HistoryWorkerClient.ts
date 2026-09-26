import { MessageChannel, Worker, type MessagePort, type WorkerOptions } from 'node:worker_threads';
import { randomUUID } from 'node:crypto';

import type {
  HistoryPersistenceBatch,
  HistoryPersistenceResult,
  HistoryWorkerEnvelope,
  HistoryWorkerRequest,
  HistoryWorkerResponse,
  HistoryWorkerValue,
  HistoryWriterLease,
} from './historyPersistenceProtocol.js';
import { historyWorkerError } from './historyPersistenceProtocol.js';
import type {
  SessionFileChange,
  SessionFileReconciliation,
  SessionFileSnapshot,
} from './sessionFileCache.js';
import type { HistorySearchReply } from './protocol.js';

const DEFAULT_TRANSPORT_TIMEOUT_MS = 10_000;
const SEARCH_TRANSPORT_TIMEOUT_MS = 60_000;

export interface HistoryPersistenceCall<T> {
  readonly promise: Promise<T>;
}

export interface HistoryPersistenceClient {
  startPersist(batch: HistoryPersistenceBatch): HistoryPersistenceCall<HistoryPersistenceResult>;
  startDurabilityBarrier(): HistoryPersistenceCall<{ durable: true }>;
  close(): Promise<void>;
}

export interface HistorySearchClient {
  reconcileSessionFiles(): Promise<SessionFileReconciliation>;
  reconcileSessionFilePaths(changes: SessionFileChange[]): Promise<SessionFileReconciliation>;
  sessionFileSnapshot(): Promise<SessionFileSnapshot>;
  setIndexingIdle(isIdle: boolean): Promise<void>;
  search(query: string): Promise<HistorySearchReply>;
  close(): Promise<void>;
}

export interface HistoryWorkerClientOptions {
  worker?: Worker;
  workerUrl?: URL;
  workerData?: unknown;
  workerFactory?: () => Worker;
  transportTimeoutMs?: number;
  scheduleWatchdog?: (callback: () => void, delayMs: number) => ReturnType<typeof setTimeout>;
  cancelWatchdog?: (timer: ReturnType<typeof setTimeout>) => void;
}

export class HistoryWorkerClient implements HistoryPersistenceClient, HistorySearchClient {
  private worker: Worker;
  private readonly createWorker: () => Worker;
  private readonly transportTimeoutMs: number;
  private readonly scheduleWatchdog: NonNullable<HistoryWorkerClientOptions['scheduleWatchdog']>;
  private readonly cancelWatchdog: NonNullable<HistoryWorkerClientOptions['cancelWatchdog']>;
  private readonly activeCalls = new Set<{ failExternal(error: Error): void }>();
  private readonly writerOwner = randomUUID();
  private writerGeneration = 1;
  private failed: Error | null = null;
  private closed = false;
  private closing: Promise<void> | null = null;

  constructor(options: HistoryWorkerClientOptions = {}) {
    this.transportTimeoutMs = options.transportTimeoutMs ?? DEFAULT_TRANSPORT_TIMEOUT_MS;
    this.scheduleWatchdog = options.scheduleWatchdog ?? scheduleTimeout;
    this.cancelWatchdog = options.cancelWatchdog ?? clearTimeout;
    const workerOptions: WorkerOptions = {
      workerData: options.workerData,
      execArgv: [],
    };
    this.createWorker =
      options.workerFactory ??
      (() => new Worker(options.workerUrl ?? defaultWorkerUrl(), workerOptions));
    this.worker = options.worker ?? this.createWorker();
    this.observeWorker(this.worker);
  }

  startPersist(batch: HistoryPersistenceBatch): HistoryPersistenceCall<HistoryPersistenceResult> {
    return this.call<HistoryPersistenceResult>({ type: 'persist', batch });
  }

  startDurabilityBarrier(): HistoryPersistenceCall<{ durable: true }> {
    return this.call<{ durable: true }>({ type: 'durability-barrier' });
  }

  async reconcileSessionFiles(): Promise<SessionFileReconciliation> {
    return await this.call<SessionFileReconciliation>({ type: 'reconcile-files' }).promise;
  }

  async reconcileSessionFilePaths(
    changes: SessionFileChange[],
  ): Promise<SessionFileReconciliation> {
    return await this.call<SessionFileReconciliation>({
      type: 'reconcile-file-paths',
      changes,
    }).promise;
  }

  async sessionFileSnapshot(): Promise<SessionFileSnapshot> {
    return await this.call<SessionFileSnapshot>({ type: 'session-file-snapshot' }).promise;
  }

  async setIndexingIdle(isIdle: boolean): Promise<void> {
    await this.call<{ accepted: true }>({ type: 'indexing-idle', isIdle }).promise;
  }

  async search(query: string): Promise<HistorySearchReply> {
    return await this.call<HistorySearchReply>({ type: 'search', query }).promise;
  }

  close(): Promise<void> {
    this.closing ??= this.performClose();
    return this.closing;
  }

  private async performClose(): Promise<void> {
    let closeError: Error | undefined;
    if (!this.failed) {
      try {
        await this.call<{ closed: true }>({ type: 'close' }).promise;
      } catch (error) {
        closeError = asError(error);
      }
    }
    this.closed = true;
    const terminal = this.failed ?? new Error('History persistence worker is closed.');
    for (const call of this.activeCalls) call.failExternal(terminal);
    this.activeCalls.clear();
    await this.worker.terminate();
    if (closeError) throw closeError;
  }

  private call<T extends HistoryWorkerValue>(request: HistoryWorkerRequest): PortWorkerCall<T> {
    if (this.closed || (this.closing && request.type !== 'close')) {
      throw new Error('History persistence worker is closed.');
    }
    this.restartFailedWorker();
    const channel = new MessageChannel();
    const call = new PortWorkerCall<T>(
      channel.port1,
      () => {
        this.activeCalls.delete(call);
      },
      (error) => {
        if (isSearchLaneRequest(request)) call.failExternal(error);
        else this.fail(error);
      },
    );
    this.activeCalls.add(call);
    const envelope: HistoryWorkerEnvelope = {
      request,
      replyPort: channel.port2,
      ...(isPersistenceRequest(request) ? { writerLease: this.writerLease() } : {}),
    };
    try {
      this.worker.postMessage(envelope, [channel.port2]);
    } catch (error) {
      const failure = asError(error);
      void call.promise.catch(() => undefined);
      call.failExternal(failure);
      channel.port2.close();
      this.fail(failure);
      throw failure;
    }
    call.startTransportWatchdog(
      isSearchLaneRequest(request) ? SEARCH_TRANSPORT_TIMEOUT_MS : this.transportTimeoutMs,
      this.scheduleWatchdog,
      this.cancelWatchdog,
    );
    return call;
  }

  private observeWorker(worker: Worker): void {
    worker.on('error', (error) => {
      if (this.worker === worker) this.fail(asError(error));
    });
    worker.on('exit', (code) => {
      if (!this.closed && this.worker === worker) {
        this.fail(new Error(`History persistence worker exited with code ${String(code)}.`));
      }
    });
  }

  private restartFailedWorker(): void {
    if (!this.failed) return;
    void this.worker.terminate();
    this.writerGeneration += 1;
    this.worker = this.createWorker();
    this.failed = null;
    this.observeWorker(this.worker);
  }

  private fail(error: Error): void {
    this.failed ??= error;
    for (const call of this.activeCalls) call.failExternal(this.failed);
    this.activeCalls.clear();
  }

  private writerLease(): HistoryWriterLease {
    return { owner: this.writerOwner, generation: this.writerGeneration, processId: process.pid };
  }
}

function isPersistenceRequest(request: HistoryWorkerRequest): boolean {
  return request.type === 'persist' || request.type === 'durability-barrier';
}

function isSearchLaneRequest(request: HistoryWorkerRequest): boolean {
  return (
    request.type === 'reconcile-files' ||
    request.type === 'reconcile-file-paths' ||
    request.type === 'session-file-snapshot' ||
    request.type === 'indexing-idle' ||
    request.type === 'search'
  );
}

class PortWorkerCall<T extends HistoryWorkerValue> implements HistoryPersistenceCall<T> {
  readonly promise: Promise<T>;
  private settled = false;
  private resolvePromise: ((value: T) => void) | undefined;
  private rejectPromise: ((error: Error) => void) | undefined;
  private transportWatchdog: ReturnType<typeof setTimeout> | undefined;
  private cancelTransportWatchdog: ((timer: ReturnType<typeof setTimeout>) => void) | undefined;

  constructor(
    private readonly port: MessagePort,
    private readonly onSettled: () => void,
    private readonly onTransportFailure: (error: Error) => void,
  ) {
    this.promise = new Promise<T>((resolve, reject) => {
      this.resolvePromise = resolve;
      this.rejectPromise = reject;
    });
    port.on('message', (response: HistoryWorkerResponse) => {
      this.settle(response);
    });
    port.on('messageerror', () => {
      this.failTransport(new Error('History persistence worker returned an invalid message.'));
    });
    port.start();
  }

  startTransportWatchdog(
    timeoutMs: number,
    schedule: (callback: () => void, delayMs: number) => ReturnType<typeof setTimeout>,
    cancel: (timer: ReturnType<typeof setTimeout>) => void,
  ): void {
    if (this.settled) return;
    this.cancelTransportWatchdog = cancel;
    this.transportWatchdog = schedule(() => {
      this.failTransport(
        new Error(`History persistence worker did not respond within ${String(timeoutMs)}ms.`),
      );
    }, timeoutMs);
  }

  failExternal(error: Error): void {
    if (this.settled) return;
    this.settled = true;
    this.rejectPromise?.(error);
    this.dispose();
  }

  private failTransport(error: Error): void {
    if (this.settled) return;
    this.onTransportFailure(error);
  }

  private settle(response: HistoryWorkerResponse): void {
    if (this.settled) return;
    if (response.ok) {
      this.settled = true;
      this.resolvePromise?.(response.value as T);
      this.dispose();
      return;
    }
    this.failExternal(historyWorkerError(response.error));
  }

  private dispose(): void {
    if (this.transportWatchdog) {
      this.cancelTransportWatchdog?.(this.transportWatchdog);
      this.transportWatchdog = undefined;
      this.cancelTransportWatchdog = undefined;
    }
    this.resolvePromise = undefined;
    this.rejectPromise = undefined;
    this.port.removeAllListeners();
    this.port.close();
    this.onSettled();
  }
}

function scheduleTimeout(callback: () => void, delayMs: number): ReturnType<typeof setTimeout> {
  const timer = setTimeout(callback, delayMs);
  timer.unref();
  return timer;
}

function defaultWorkerUrl(): URL {
  const source = import.meta.url.endsWith('.ts');
  return new URL(
    source ? './historyPersistenceWorkerLoader.mjs' : './historyPersistenceWorker.mjs',
    import.meta.url,
  );
}

function asError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}
