import { watch, type FSWatcher } from 'node:fs';
import { lstat, realpath } from 'node:fs/promises';
import { resolve } from 'node:path';
import { isPathInside } from './isPathInside.js';

import type { UsageDatabase } from './UsageDatabase.js';
import {
  defaultUsageRoots,
  discoverUsageFiles,
  type UsageDiscoveryItem,
  type UsageSourceFile,
  type UsageSourceRoot,
} from './UsageDiscovery.js';
import { ingestUsageFile, UsageIngestResetRequiredError } from './UsageFileIngest.js';

const MAX_DIRTY_FILES = 4_096;
const MAX_PENDING_FILES = 4_096;
const MAX_FILES_PER_RECONCILE = 16;
const RESERVED_QUEUE_FILES = 6;
const QUEUE_SHARE_WITHOUT_SCAN = MAX_FILES_PER_RECONCILE / 2;
export type { UsageSourceRoot } from './UsageDiscovery.js';
export interface UsageReconcileResult {
  scannedEntries: number;
  processedFiles: number;
  insertedEvents: number;
  malformedRecords: number;
  oversizedRecords: number;
  deferredFiles: number;
  unavailableSources: number;
}
export interface UsageIngestOptions {
  database: Pick<UsageDatabase, 'cursor' | 'ingest'>;
  roots?: readonly UsageSourceRoot[];
  onError?: (error: Error) => void;
  onReconciled?: () => void;
}
export class UsageIngest {
  private readonly roots: UsageSourceRoot[];
  private readonly watchers = new Map<string, FSWatcher>();
  private readonly pendingFiles = new Map<string, UsageSourceFile>();
  private readonly dirtyFiles = new Map<string, UsageSourceFile>();
  private discovery: AsyncGenerator<UsageDiscoveryItem> | null = null;
  private inFlight: Promise<UsageReconcileResult> | null = null;
  private debounceTimer: NodeJS.Timeout | null = null;
  private intervalTimer: NodeJS.Timeout | null = null;
  private wakePending = false;
  private drainingStartup = false;
  private fullScanPending = true;
  private started = false;
  private closed = false;
  constructor(private readonly options: UsageIngestOptions) {
    this.roots = (options.roots ?? defaultUsageRoots()).map((root) => ({
      ...root,
      path: resolve(root.path),
    }));
  }
  async start(): Promise<UsageReconcileResult> {
    if (this.closed) throw new Error('Usage ingest is closed.');
    const isOpen = () => !this.closed;
    const hasStartupWork = () => this.hasQueuedWork();
    this.started = true;
    await this.ensureWatchers();
    const result = emptyResult();
    this.drainingStartup = true;
    try {
      while (isOpen()) {
        this.wakePending = false;
        addResult(result, await this.beginReconcile());
        if (!hasStartupWork()) break;
        await new Promise<void>((resolve) => setImmediate(resolve));
      }
    } finally {
      this.drainingStartup = false;
    }
    if (isOpen() && this.wakePending) {
      this.wakePending = false;
      this.scheduleReconcile(0);
    }
    if (isOpen()) {
      this.intervalTimer ??= setInterval(() => {
        this.scheduleReconcile(0, true);
      }, 60_000);
      this.intervalTimer.unref();
    }
    return result;
  }

  reconcile(): Promise<UsageReconcileResult> {
    this.fullScanPending = true;
    return this.beginReconcile();
  }

  private beginReconcile(): Promise<UsageReconcileResult> {
    if (this.closed) throw new Error('Usage ingest is closed.');
    if (this.inFlight) return this.inFlight;
    const operation = this.runReconcile().then((result) => {
      this.options.onReconciled?.();
      return result;
    });
    this.inFlight = operation;
    void operation
      .finally(() => {
        if (this.inFlight === operation) this.inFlight = null;
        if (
          !this.closed &&
          this.started &&
          !this.drainingStartup &&
          (this.wakePending || this.hasQueuedWork())
        ) {
          this.wakePending = false;
          this.scheduleReconcile(0, false);
        }
      })
      .catch(() => undefined);
    return operation;
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    if (this.debounceTimer) clearTimeout(this.debounceTimer);
    if (this.intervalTimer) clearInterval(this.intervalTimer);
    for (const watcher of this.watchers.values()) watcher.close();
    this.watchers.clear();
    await this.inFlight?.catch(() => undefined);
    await this.discovery?.return(undefined);
    this.discovery = null;
    this.pendingFiles.clear();
    this.dirtyFiles.clear();
  }

  private async runReconcile(): Promise<UsageReconcileResult> {
    if (this.started) await this.ensureWatchers();
    const result = emptyResult();
    if (this.discovery === null && this.fullScanPending) {
      this.fullScanPending = false;
      this.discovery = discoverUsageFiles(this.roots);
    }
    const scanActive = this.discovery !== null;
    let dirtyBudget = Math.min(
      queueBudget(scanActive, this.pendingFiles.size),
      this.dirtyFiles.size,
    );
    let pendingBudget = Math.min(
      queueBudget(scanActive, this.dirtyFiles.size),
      this.pendingFiles.size,
    );
    let visitedFiles = 0;
    while (result.scannedEntries < 2_048 && visitedFiles < MAX_FILES_PER_RECONCILE) {
      let file: UsageSourceFile;
      if (dirtyBudget > 0) {
        const next = this.dirtyFiles.entries().next().value;
        if (!next) break;
        const [key, dirty] = next;
        this.dirtyFiles.delete(key);
        file = dirty;
        dirtyBudget -= 1;
      } else if (pendingBudget > 0) {
        const next = this.pendingFiles.entries().next().value;
        if (!next) break;
        const [key, pending] = next;
        this.pendingFiles.delete(key);
        file = pending;
        pendingBudget -= 1;
      } else {
        if (!this.discovery) break;
        const next = await this.discovery.next();
        if (next.done) {
          this.discovery = null;
          break;
        }
        if (next.value === 'unavailable') {
          result.unavailableSources += 1;
          continue;
        }
        result.scannedEntries += 1;
        if (next.value === 'entry') continue;
        file = next.value;
      }
      visitedFiles += 1;
      const key = fileKey(file);
      this.dirtyFiles.delete(key);
      this.pendingFiles.delete(key);
      try {
        const fileResult = await ingestUsageFile(file, this.options.database);
        if (!fileResult) continue;
        result.processedFiles += 1;
        result.insertedEvents += fileResult.insertedEvents;
        result.malformedRecords += fileResult.malformedRecords;
        result.oversizedRecords += fileResult.oversizedRecords;
        if (fileResult.deferred) result.deferredFiles += 1;
        if (fileResult.continueNow) this.queuePendingFile(file);
      } catch (error) {
        if (error instanceof UsageIngestResetRequiredError) throw error;
        if (!isUnavailable(error)) throw error;
        result.unavailableSources += 1;
      }
    }
    if (this.started && !this.drainingStartup && this.hasQueuedWork()) {
      this.wakePending = true;
    }
    return result;
  }

  private async ensureWatchers(): Promise<void> {
    for (const root of this.roots) {
      const watcherKey = `${root.parserName}\0${root.path}`;
      if (this.watchers.has(watcherKey)) continue;
      const stats = await lstat(root.path).catch(() => null);
      if (!stats?.isDirectory() || stats.isSymbolicLink()) continue;
      try {
        const canonicalRoot = await realpath(root.path);
        const watcher = watch(canonicalRoot, { recursive: true }, (event, filename) => {
          if (!filename) {
            this.scheduleReconcile(250, true);
            return;
          }
          const path = resolve(canonicalRoot, filename);
          if (!isPathInside(canonicalRoot, path)) {
            this.scheduleReconcile(250, true);
            return;
          }
          if (!path.endsWith('.jsonl')) {
            if (event === 'rename') this.scheduleReconcile(250, true);
            return;
          }
          const dirty = { ...root, rootPath: canonicalRoot, path };
          const key = fileKey(dirty);
          if (!this.dirtyFiles.has(key) && this.dirtyFiles.size >= MAX_DIRTY_FILES) {
            this.scheduleReconcile(250, true);
            return;
          }
          this.pendingFiles.delete(key);
          this.dirtyFiles.set(key, dirty);
          this.scheduleReconcile(250, false);
        });
        watcher.unref();
        watcher.on('error', () => {
          watcher.close();
          this.watchers.delete(watcherKey);
        });
        this.watchers.set(watcherKey, watcher);
      } catch {
        // Periodic reconciliation remains the correctness path.
      }
    }
  }

  private scheduleReconcile(delayMs = 250, fullScan = false): void {
    if (this.closed) return;
    this.fullScanPending ||= fullScan;
    if (this.inFlight) {
      this.wakePending = true;
      return;
    }
    if (this.debounceTimer) return;
    this.debounceTimer = setTimeout(
      () => {
        this.debounceTimer = null;
        void this.beginReconcile().catch((error: unknown) => {
          this.options.onError?.(
            error instanceof Error ? error : new Error('Usage reconciliation failed.'),
          );
        });
      },
      Math.max(0, delayMs),
    );
    this.debounceTimer.unref();
  }

  private hasQueuedWork(): boolean {
    return (
      this.fullScanPending ||
      this.discovery !== null ||
      this.pendingFiles.size > 0 ||
      this.dirtyFiles.size > 0
    );
  }

  private queuePendingFile(file: UsageSourceFile): void {
    const key = fileKey(file);
    if (!this.pendingFiles.has(key) && this.pendingFiles.size >= MAX_PENDING_FILES) {
      this.fullScanPending = true;
      return;
    }
    this.pendingFiles.set(key, file);
  }
}

export function createUsageIngest(options: UsageIngestOptions): UsageIngest {
  return new UsageIngest(options);
}

function isUnavailable(error: unknown): boolean {
  if (!error || typeof error !== 'object' || !('code' in error)) return false;
  return ['ENOENT', 'ENOTDIR', 'EACCES', 'EPERM', 'ELOOP', 'ESTALE'].includes(String(error.code));
}

function addResult(total: UsageReconcileResult, result: UsageReconcileResult): void {
  total.scannedEntries += result.scannedEntries;
  total.processedFiles += result.processedFiles;
  total.insertedEvents += result.insertedEvents;
  total.malformedRecords += result.malformedRecords;
  total.oversizedRecords += result.oversizedRecords;
  total.deferredFiles += result.deferredFiles;
  total.unavailableSources += result.unavailableSources;
}

function queueBudget(scanActive: boolean, competingFiles: number): number {
  if (scanActive) return RESERVED_QUEUE_FILES;
  return competingFiles > 0 ? QUEUE_SHARE_WITHOUT_SCAN : MAX_FILES_PER_RECONCILE;
}

function fileKey(file: Pick<UsageSourceFile, 'parserName' | 'path'>): string {
  return `${file.parserName}\0${file.path}`;
}

function emptyResult(): UsageReconcileResult {
  return {
    scannedEntries: 0,
    processedFiles: 0,
    insertedEvents: 0,
    malformedRecords: 0,
    oversizedRecords: 0,
    deferredFiles: 0,
    unavailableSources: 0,
  };
}
