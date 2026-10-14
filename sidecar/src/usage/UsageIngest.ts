import { createHash } from 'node:crypto';
import { constants, watch, type FSWatcher, type Stats } from 'node:fs';
import { lstat, open, realpath, type FileHandle } from 'node:fs/promises';
import { isAbsolute, relative, resolve, sep } from 'node:path';

import type { UsageDatabase, UsageCursorAdvance } from './UsageDatabase.js';
import {
  defaultUsageRoots,
  discoverUsageFiles,
  type UsageDiscoveryItem,
  type UsageSourceFile,
  type UsageSourceRoot,
} from './UsageDiscovery.js';
import { createUsageParserState, parseUsageRecord } from './parsers.js';
import type { UsageEvent, UsageParserName, UsageParserState } from './types.js';
import { restoreUsageParserState } from './types.js';

const DEFAULT_MAX_RECORD_BYTES = 1024 * 1024;
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
}
class UsageIngestResetRequiredError extends Error {
  constructor(readonly sourceId: string) {
    super(`Usage source ${sourceId} requires a local ledger reset and rebuild.`);
  }
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
    const operation = this.runReconcile();
    this.inFlight = operation;
    void operation
      .finally(() => {
        if (this.inFlight === operation) this.inFlight = null;
        if (!this.closed && !this.drainingStartup && (this.wakePending || this.hasQueuedWork())) {
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
        const fileResult = await this.processFile(file);
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

  private async processFile(file: UsageSourceFile) {
    const candidate = await lstat(file.path);
    if (candidate.isSymbolicLink() || !candidate.isFile()) return null;
    const candidateId = sourceId(file.parserName, file.path);
    const parserState = createUsageParserState(file.parserName);
    const candidateCursor = this.options.database.cursor(file.path);
    if (isUnchangedCompleteFile(candidateCursor, candidate, candidateId, parserState)) return null;

    const canonicalPath = await realpath(file.path);
    if (!inside(file.rootPath, canonicalPath)) return null;
    const handle = await open(canonicalPath, constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
      const before = await handle.stat();
      if (!before.isFile()) return null;
      const id = sourceId(file.parserName, canonicalPath);
      const expected = this.options.database.cursor(canonicalPath);
      const freshState = parserState;
      if (
        expected &&
        (expected.sourceId !== id ||
          expected.parserName !== file.parserName ||
          expected.parserVersion !== freshState.parserVersion)
      ) {
        throw new UsageIngestResetRequiredError(id);
      }
      const identity = fileIdentity(before, id);
      const observedMtime = Math.trunc(before.mtimeMs);
      const reset = expected
        ? expected.fileIdentity !== identity ||
          before.size < expected.fileSize ||
          before.size < expected.byteOffset ||
          (before.size === expected.fileSize && observedMtime !== expected.mtimeMs) ||
          !Buffer.from(expected.guard).equals(
            Buffer.from(await readGuard(handle, expected.byteOffset)),
          )
        : false;
      const offset = reset ? 0 : (expected?.byteOffset ?? 0);
      const restored =
        expected && !reset
          ? restoreUsageParserState(expected.parserName, expected.parserState)
          : null;
      if (expected && !reset && restored?.parserVersion !== expected.parserVersion) {
        throw new UsageIngestResetRequiredError(id);
      }
      let state = restored ?? freshState;
      const readOffset = offset;
      const available = Math.max(0, before.size - readOffset);
      const readLength = Math.min(available, 4 * 1024 * 1024);
      const bytes = Buffer.allocUnsafe(readLength);
      const read =
        readLength === 0 ? 0 : (await handle.read(bytes, 0, readLength, readOffset)).bytesRead;
      let records = bytes.subarray(0, read);
      let recordsOffset = readOffset;
      let completedOversized = 0;
      let discardingOversized = !reset && expected?.discardingOversized === true;
      if (discardingOversized) {
        const newline = records.indexOf(0x0a);
        if (newline === -1) {
          recordsOffset += records.length;
          records = records.subarray(records.length);
        } else {
          discardingOversized = false;
          completedOversized = 1;
          recordsOffset += newline + 1;
          records = records.subarray(newline + 1);
        }
      }
      const parsed = parseLines(
        records,
        recordsOffset,
        id,
        file.parserName,
        state,
        DEFAULT_MAX_RECORD_BYTES,
      );
      state = parsed.state;
      const oversizedTail =
        !discardingOversized &&
        !parsed.hasRecordBacklog &&
        records.length - parsed.consumedBytes > DEFAULT_MAX_RECORD_BYTES;
      discardingOversized ||= oversizedTail;
      const nextOffset = discardingOversized
        ? readOffset + read
        : recordsOffset + parsed.consumedBytes;
      const after = await handle.stat();
      if (after.size < nextOffset) throw new Error('Usage source changed while it was read.');
      const shouldCommit = !expected || reset || nextOffset > offset;
      let insertedEvents = 0;
      if (shouldCommit) {
        const nextCursor: UsageCursorAdvance = {
          sourcePath: canonicalPath,
          sourceId: id,
          fileIdentity: identity,
          byteOffset: nextOffset,
          fileSize: after.size,
          mtimeMs: Math.trunc(after.mtimeMs),
          guard: await readGuard(handle, nextOffset),
          parserName: file.parserName,
          parserVersion: freshState.parserVersion,
          parserState: JSON.stringify(state),
          discardingOversized,
        };
        const committed = this.options.database.ingest({
          expectedCursor: expected,
          nextCursor,
          reset,
          events: parsed.events,
        });
        insertedEvents = committed.insertedEvents;
      }
      return {
        insertedEvents,
        malformedRecords: parsed.malformedRecords,
        oversizedRecords: parsed.oversizedRecords + completedOversized,
        deferred: discardingOversized || nextOffset < after.size,
        continueNow: parsed.hasRecordBacklog || readOffset + read < after.size,
      };
    } finally {
      await handle.close();
    }
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
          if (!inside(canonicalRoot, path)) {
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

function parseLines(
  bytes: Buffer,
  offset: number,
  source: string,
  parserName: UsageParserName,
  initialState: UsageParserState,
  maxRecordBytes: number,
) {
  let state = initialState;
  const events: UsageEvent[] = [];
  let start = 0;
  let records = 0;
  let malformedRecords = 0;
  let oversizedRecords = 0;
  while (records < 2_048) {
    const newline = bytes.indexOf(0x0a, start);
    if (newline === -1) break;
    records += 1;
    const length = newline - start;
    if (length > maxRecordBytes) {
      oversizedRecords += 1;
    } else {
      try {
        const value: unknown = JSON.parse(bytes.subarray(start, newline).toString('utf8'));
        const parsed = parseUsageRecord(parserName, value, state, {
          sourceId: source,
          recordStartByte: offset + start,
          recordEndByte: offset + newline + 1,
        });
        state = parsed.state;
        events.push(...parsed.events);
      } catch {
        malformedRecords += 1;
      }
    }
    start = newline + 1;
  }
  return {
    state,
    events,
    consumedBytes: start,
    malformedRecords,
    oversizedRecords,
    hasRecordBacklog: records === 2_048 && start < bytes.length,
  };
}

async function readGuard(handle: FileHandle, offset: number): Promise<Uint8Array> {
  const length = Math.min(64, offset);
  const tail = Buffer.allocUnsafe(length);
  if (length > 0) {
    const read = await handle.read(tail, 0, length, offset - length);
    if (read.bytesRead !== length) throw new Error('Usage source changed while it was read.');
  }
  const size = Buffer.allocUnsafe(4);
  size.writeUInt32BE(length);
  return createHash('sha512').update('droidex-usage-guard-v1\0').update(size).update(tail).digest();
}

function fileIdentity(stats: Stats, fallback: string): string {
  if (stats.ino !== 0 || stats.dev !== 0) {
    return `dev:${String(stats.dev)}:ino:${String(stats.ino)}:birth:${String(Math.trunc(stats.birthtimeMs))}`;
  }
  return `source:${fallback}:birth:${String(Math.trunc(stats.birthtimeMs))}`;
}
function sourceId(parserName: UsageParserName, path: string): string {
  return `${parserName}:${createHash('sha256').update(resolve(path)).digest('hex').slice(0, 32)}`;
}
function inside(root: string, path: string): boolean {
  const child = relative(root, path);
  return child !== '' && child !== '..' && !child.startsWith(`..${sep}`) && !isAbsolute(child);
}

function isUnavailable(error: unknown): boolean {
  if (!error || typeof error !== 'object' || !('code' in error)) return false;
  return ['ENOENT', 'ENOTDIR', 'EACCES', 'EPERM', 'ELOOP', 'ESTALE'].includes(String(error.code));
}

function isUnchangedCompleteFile(
  cursor: ReturnType<UsageDatabase['cursor']>,
  stats: Stats,
  id: string,
  state: UsageParserState,
): boolean {
  return (
    cursor !== null &&
    cursor.sourceId === id &&
    cursor.fileIdentity === fileIdentity(stats, id) &&
    cursor.byteOffset === stats.size &&
    cursor.fileSize === stats.size &&
    cursor.mtimeMs === Math.trunc(stats.mtimeMs) &&
    cursor.parserName === state.parserName &&
    cursor.parserVersion === state.parserVersion &&
    !cursor.discardingOversized &&
    restoreUsageParserState(cursor.parserName, cursor.parserState) !== null
  );
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
