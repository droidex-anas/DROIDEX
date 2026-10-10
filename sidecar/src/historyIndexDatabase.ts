import { existsSync, renameSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { DatabaseSync, type SQLInputValue } from 'node:sqlite';

import { createHistorySessionFileCache, SESSION_SEARCH_INDEX_FILENAME } from './history.js';
import { HistorySearchIndex } from './historySearchIndex.js';
import { PERMISSION_SEMANTICS_REVISION } from './permissionSemantics.js';
import { initializeSessionFileCacheSchema } from './sessionFileCacheSchema.js';
import {
  HistorySearchUnavailableError,
  isHistorySearchUnavailableError,
} from './historySearchSchema.js';
import type {
  SearchableSessionFileEntry,
  SessionFileChange,
  SessionFileCacheEntry,
  SessionFileReconciliation,
  SessionFileSnapshot,
} from './sessionFileCache.js';
import type { SessionSearchResult } from './protocol.js';

const RECENT_HISTORY_WINDOW_MS = 7 * 24 * 60 * 60 * 1_000;
const RECENT_SLICE_DELAY_MS = 2_000;
const IDLE_BACKFILL_SLICE_DELAY_MS = 5_000;
const INDEX_RETRY_DELAY_MS = 1_000;
const MAX_INDEX_RETRY_DELAY_MS = 60_000;

interface HistoryIndexDatabaseOptions {
  now?: () => number;
  recentWindowMs?: number;
  recentSliceDelayMs?: number;
  idleBackfillSliceDelayMs?: number;
  schedule?: (
    callback: () => void | Promise<void>,
    delayMs: number,
  ) => ReturnType<typeof setTimeout>;
  cancel?: (timer: ReturnType<typeof setTimeout>) => void;
}

export class HistoryIndexDatabase {
  private readonly canonicalDb: DatabaseSync;
  private readonly derivedDb: DatabaseSync;
  private readonly sessionFiles;
  private readonly searchIndex: HistorySearchIndex | null;
  private readonly searchUnavailable: HistorySearchUnavailableError | null;
  private readonly now: () => number;
  private readonly recentWindowMs: number;
  private readonly recentSliceDelayMs: number;
  private readonly idleBackfillSliceDelayMs: number;
  private readonly schedule: NonNullable<HistoryIndexDatabaseOptions['schedule']>;
  private readonly cancel: NonNullable<HistoryIndexDatabaseOptions['cancel']>;
  private readonly recentQueue = new Map<string, SearchableSessionFileEntry>();
  private readonly backfillQueue = new Map<string, SearchableSessionFileEntry>();
  private indexingTimer: ReturnType<typeof setTimeout> | null = null;
  private activeSlice: Promise<void> | null = null;
  private activeQueueEntry: {
    providerSessionId: string;
    entry: SearchableSessionFileEntry;
    queue: Map<string, SearchableSessionFileEntry>;
    isBackfill: boolean;
    superseded: boolean;
  } | null = null;
  private readonly retryFailures = new Map<string, number>();
  private readonly retryNotBefore = new Map<string, number>();
  private hasPlannedAll = false;
  private isIdle = false;
  private closed = false;

  constructor(dbPath: string, options: HistoryIndexDatabaseOptions = {}) {
    this.canonicalDb = new DatabaseSync(dbPath, { readOnly: true });
    let derived: ReturnType<typeof openDerivedStorage>;
    try {
      const derivedPath = join(dirname(dbPath), SESSION_SEARCH_INDEX_FILENAME);
      derived = openDerivedStorage(derivedPath, this.canonicalDb);
    } catch (error) {
      this.canonicalDb.close();
      throw error;
    }
    this.derivedDb = derived.db;
    this.sessionFiles = derived.sessionFiles;
    this.searchIndex = derived.searchIndex;
    this.searchUnavailable = derived.searchUnavailable;
    this.now = options.now ?? Date.now;
    this.recentWindowMs = options.recentWindowMs ?? RECENT_HISTORY_WINDOW_MS;
    this.recentSliceDelayMs = options.recentSliceDelayMs ?? RECENT_SLICE_DELAY_MS;
    this.idleBackfillSliceDelayMs =
      options.idleBackfillSliceDelayMs ?? IDLE_BACKFILL_SLICE_DELAY_MS;
    this.schedule = options.schedule ?? scheduleTimer;
    this.cancel = options.cancel ?? clearTimeout;
  }

  reconcileSessionFiles(): SessionFileReconciliation {
    this.assertOpen();
    const result = this.sessionFiles.reconcileChanges();
    const removed = [
      ...result.removedProviderSessionIds,
      ...this.sessionFiles.unavailableProviderSessionIds,
      ...result.upserts
        .filter((entry) => entry.summary === null)
        .map((entry) => entry.providerSessionId),
    ];
    for (const providerSessionId of removed) this.removeQueued(providerSessionId);
    const searchIndex = this.searchIndex;
    if (!searchIndex)
      return { ...result, searchUnavailableReason: this.searchUnavailable?.message };
    const plan = searchIndex.reconcileEntries(this.sessionFiles.searchableEntries());
    this.hasPlannedAll = true;
    this.enqueueEntries(plan.pendingEntries, false);
    return result;
  }

  reconcileSessionFilePaths(changes: SessionFileChange[]): SessionFileReconciliation {
    this.assertOpen();
    const result = this.sessionFiles.reconcilePathChanges(changes);
    const unavailable = this.sessionFiles.unavailableProviderSessionIds;
    for (const providerSessionId of unavailable) this.removeQueued(providerSessionId);
    const searchIndex = this.searchIndex;
    if (!searchIndex)
      return { ...result, searchUnavailableReason: this.searchUnavailable?.message };
    if (!this.hasPlannedAll) {
      const plan = searchIndex.reconcileEntries(this.sessionFiles.searchableEntries());
      this.hasPlannedAll = true;
      this.enqueueEntries(plan.pendingEntries, false);
      return result;
    }
    const searchable = result.upserts.filter(isSearchableEntry);
    const removed = [
      ...result.removedProviderSessionIds,
      ...unavailable,
      ...result.upserts
        .filter((entry) => entry.summary === null)
        .map((entry) => entry.providerSessionId),
    ];
    const plan = searchIndex.applyEntryChanges(searchable, removed);
    for (const providerSessionId of removed) this.removeQueued(providerSessionId);
    this.enqueueEntries(plan.pendingEntries, true);
    return result;
  }

  sessionFileSnapshot(): SessionFileSnapshot {
    this.assertOpen();
    return this.sessionFiles.snapshot();
  }

  search(query: string, isStale?: () => boolean): SessionSearchResult[] {
    this.assertOpen();
    if (this.searchUnavailable) throw this.searchUnavailable;
    this.ensurePlannedAll();
    this.pauseActiveBackfill();
    const results = isStale?.() ? [] : this.requireSearchIndex().search(query, isStale);
    this.scheduleNext();
    return results;
  }

  isIndexingIncomplete(): boolean {
    this.assertOpen();
    if (this.searchUnavailable) return false;
    return (
      !this.hasPlannedAll ||
      this.recentQueue.size > 0 ||
      this.backfillQueue.size > 0 ||
      this.activeSlice !== null
    );
  }

  setIdle(isIdle: boolean): void {
    this.assertOpen();
    const changed = this.isIdle !== isIdle;
    this.isIdle = isIdle;
    if (this.searchUnavailable) return;
    if (isIdle) this.ensurePlannedAll();
    else this.pauseActiveBackfill();
    if (changed) this.cancelScheduledSlice();
    this.scheduleNext();
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    if (this.indexingTimer) {
      this.cancel(this.indexingTimer);
      this.indexingTimer = null;
    }
    let firstError: unknown;
    try {
      if (this.activeSlice) await this.activeSlice;
    } catch (error) {
      firstError = error;
    }
    try {
      this.derivedDb.close();
    } catch (error) {
      firstError ??= error;
    }
    try {
      this.canonicalDb.close();
    } catch (error) {
      firstError ??= error;
    }
    if (firstError !== undefined) {
      throw firstError instanceof Error
        ? firstError
        : new Error('History index shutdown failed.', { cause: firstError });
    }
  }

  private ensurePlannedAll(): void {
    if (this.hasPlannedAll || this.searchUnavailable) return;
    const plan = this.requireSearchIndex().reconcileEntries(this.sessionFiles.searchableEntries());
    this.hasPlannedAll = true;
    this.enqueueEntries(plan.pendingEntries, false);
  }

  private enqueueEntries(entries: SearchableSessionFileEntry[], forceRecent: boolean): void {
    const recentCutoff = this.now() - this.recentWindowMs;
    const ordered = [...entries].sort(
      (left, right) => right.summary.updatedAt - left.summary.updatedAt,
    );
    for (const entry of ordered) {
      this.removeQueued(entry.providerSessionId);
      const isRecent = forceRecent || entry.summary.updatedAt >= recentCutoff;
      (isRecent ? this.recentQueue : this.backfillQueue).set(entry.providerSessionId, entry);
    }
    this.cancelScheduledSlice();
    this.scheduleNext();
  }

  private removeQueued(providerSessionId: string): void {
    this.recentQueue.delete(providerSessionId);
    this.backfillQueue.delete(providerSessionId);
    this.retryFailures.delete(providerSessionId);
    this.retryNotBefore.delete(providerSessionId);
    if (this.activeQueueEntry?.providerSessionId === providerSessionId) {
      this.activeQueueEntry.superseded = true;
    }
  }

  private scheduleNext(): void {
    if (this.closed || this.indexingTimer || this.activeSlice) return;
    const now = this.now();
    const recentDueAt = this.queueDueAt(this.recentQueue, this.recentLaneDelayMs(), now);
    const backfillDueAt = this.isIdle
      ? this.queueDueAt(this.backfillQueue, this.idleBackfillSliceDelayMs, now)
      : undefined;
    const dueAt = minimumDefined(recentDueAt, backfillDueAt);
    if (dueAt === undefined) return;
    const delayMs = Math.max(0, dueAt - now);
    this.indexingTimer = this.schedule(() => {
      this.indexingTimer = null;
      return this.runScheduledSlice();
    }, delayMs);
  }

  private cancelScheduledSlice(): void {
    if (!this.indexingTimer) return;
    this.cancel(this.indexingTimer);
    this.indexingTimer = null;
  }

  private async runScheduledSlice(): Promise<void> {
    try {
      await this.runOneSlice();
    } catch (error) {
      console.error('History search indexing slice failed:', error);
    } finally {
      this.scheduleNext();
    }
  }

  private async runOneSlice(): Promise<void> {
    if (this.activeSlice) {
      await this.activeSlice;
      return;
    }
    const now = this.now();
    let queue: Map<string, SearchableSessionFileEntry> | null = this.hasEligibleEntry(
      this.recentQueue,
      now,
    )
      ? this.recentQueue
      : null;
    if (!queue && this.isIdle && this.hasEligibleEntry(this.backfillQueue, now)) {
      queue = this.backfillQueue;
    }
    if (!queue) return;
    const next = this.firstEligibleEntry(queue, now);
    if (!next) return;
    const [providerSessionId, entry] = next;
    queue.delete(providerSessionId);
    const activeQueueEntry = {
      providerSessionId,
      entry,
      queue,
      isBackfill: queue === this.backfillQueue,
      superseded: false,
    };
    this.activeQueueEntry = activeQueueEntry;
    const operation = this.indexEntrySlice(queue, entry, activeQueueEntry);
    this.activeSlice = operation;
    try {
      await operation;
    } finally {
      if (this.activeSlice === operation) this.activeSlice = null;
      if (this.activeQueueEntry === activeQueueEntry) this.activeQueueEntry = null;
    }
  }

  private async indexEntrySlice(
    queue: Map<string, SearchableSessionFileEntry>,
    entry: SearchableSessionFileEntry,
    activeQueueEntry: { providerSessionId: string; superseded: boolean },
  ): Promise<void> {
    try {
      const result = await this.requireSearchIndex().indexSlice(
        entry,
        () => this.closed || activeQueueEntry.superseded,
      );
      if (this.closed || activeQueueEntry.superseded) return;
      this.retryFailures.delete(entry.providerSessionId);
      this.retryNotBefore.delete(entry.providerSessionId);
      if (!result.complete && result.indexedBytes > 0) {
        queue.set(entry.providerSessionId, entry);
      }
    } catch (error) {
      if (this.closed || activeQueueEntry.superseded) return;
      if (
        error instanceof Error &&
        'code' in error &&
        error.code === 'ENOENT' &&
        this.sessionFiles.retainsSummary(entry.providerSessionId)
      ) {
        // A missed watcher deletion must stop retries without losing the catalog row.
        this.reconcileSessionFilePaths([
          { providerSessionId: entry.providerSessionId, path: entry.path },
        ]);
        if (this.activeQueueEntry?.superseded) return;
      }
      queue.set(entry.providerSessionId, entry);
      const failures = (this.retryFailures.get(entry.providerSessionId) ?? 0) + 1;
      this.retryFailures.set(entry.providerSessionId, failures);
      const retryDelayMs = Math.min(
        INDEX_RETRY_DELAY_MS * 2 ** Math.min(failures - 1, 6),
        MAX_INDEX_RETRY_DELAY_MS,
      );
      this.retryNotBefore.set(entry.providerSessionId, this.now() + retryDelayMs);
      throw error;
    }
  }

  private recentLaneDelayMs(): number {
    return this.isIdle ? this.idleBackfillSliceDelayMs : this.recentSliceDelayMs;
  }

  private queueDueAt(
    queue: Map<string, SearchableSessionFileEntry>,
    laneDelayMs: number,
    now: number,
  ): number | undefined {
    if (queue.size === 0) return undefined;
    let earliestRetry: number | undefined;
    for (const providerSessionId of queue.keys()) {
      const retryAt = this.retryNotBefore.get(providerSessionId) ?? 0;
      if (retryAt <= now) return now + laneDelayMs;
      earliestRetry = earliestRetry === undefined ? retryAt : Math.min(earliestRetry, retryAt);
    }
    return earliestRetry;
  }

  private hasEligibleEntry(queue: Map<string, SearchableSessionFileEntry>, now: number): boolean {
    return this.firstEligibleEntry(queue, now) !== undefined;
  }

  private firstEligibleEntry(
    queue: Map<string, SearchableSessionFileEntry>,
    now: number,
  ): [string, SearchableSessionFileEntry] | undefined {
    for (const entry of queue) {
      if ((this.retryNotBefore.get(entry[0]) ?? 0) <= now) return entry;
    }
    return undefined;
  }

  private pauseActiveBackfill(): void {
    const active = this.activeQueueEntry;
    if (!active?.isBackfill || active.superseded) return;
    active.superseded = true;
    active.queue.set(active.providerSessionId, active.entry);
  }

  private requireSearchIndex(): HistorySearchIndex {
    if (this.searchIndex) return this.searchIndex;
    throw this.searchUnavailable ?? new HistorySearchUnavailableError();
  }

  private assertOpen(): void {
    if (this.closed) throw new Error('History index database is closed.');
  }
}

function isSearchableEntry(
  entry: SessionFileCacheEntry,
): entry is SessionFileCacheEntry & { summary: NonNullable<SessionFileCacheEntry['summary']> } {
  return entry.summary !== null;
}

function scheduleTimer(
  callback: () => void | Promise<void>,
  delayMs: number,
): ReturnType<typeof setTimeout> {
  const timer = setTimeout(() => void callback(), delayMs);
  timer.unref();
  return timer;
}

function minimumDefined(left: number | undefined, right: number | undefined): number | undefined {
  if (left === undefined) return right;
  if (right === undefined) return left;
  return Math.min(left, right);
}

const SALVAGED_COLUMNS =
  'provider_session_id, path, birthtime_ms, mtime_ms, size_bytes, settings_mtime_ms, summary_json, launch_settings_json';

function openDerivedStorage(path: string, canonicalDb: DatabaseSync) {
  try {
    return createDerivedStorage(path, canonicalDb);
  } catch (error) {
    // Missing FTS5 is a host capability gap, not a corrupt derived file.
    if (isHistorySearchUnavailableError(error) || !isDatabaseCorruption(error)) throw error;
    // This file also holds admitted summaries that missing transcripts cannot
    // reconstruct, so it is set aside for repair rather than deleted, and the
    // rebuild keeps every cached session row the damaged copy still yields.
    salvageSessionFileCache(path, setAsideDerivedStorage(path));
    try {
      return createDerivedStorage(path, canonicalDb);
    } catch (rebuildError) {
      throw new Error(corruptSearchStorageMessage(path), { cause: rebuildError });
    }
  }
}

function createDerivedStorage(path: string, canonicalDb: DatabaseSync) {
  const db = new DatabaseSync(path);
  try {
    db.exec('PRAGMA journal_mode = WAL');
    db.exec('PRAGMA busy_timeout = 5000');
    const sessionFiles = createHistorySessionFileCache(db, canonicalDb);
    try {
      return {
        db,
        sessionFiles,
        searchIndex: new HistorySearchIndex(db, canonicalDb),
        searchUnavailable: null,
      };
    } catch (error) {
      if (!isHistorySearchUnavailableError(error) && !isDatabaseCorruption(error)) throw error;
      // Readable summaries must stay available even when FTS cannot initialize;
      // deleting this shared file would lose chats whose transcripts are missing.
      const searchUnavailable = isHistorySearchUnavailableError(error)
        ? error
        : new HistorySearchUnavailableError(corruptSearchStorageMessage(path), { cause: error });
      return {
        db,
        sessionFiles,
        searchIndex: null,
        searchUnavailable,
      };
    }
  } catch (error) {
    try {
      db.close();
    } catch {
      // Preserve the initialization failure.
    }
    throw error;
  }
}

// Keeps SQLite's -wal/-shm naming so the set-aside copy still opens whole.
function setAsideDerivedStorage(path: string): string {
  const setAside = `${path}.corrupt-${String(Date.now())}`;
  for (const suffix of ['', '-wal', '-shm']) {
    if (existsSync(`${path}${suffix}`)) renameSync(`${path}${suffix}`, `${setAside}${suffix}`);
  }
  return setAside;
}

function salvageSessionFileCache(path: string, damagedPath: string): void {
  const db = new DatabaseSync(path);
  try {
    initializeSessionFileCacheSchema(db);
    db.prepare('ATTACH DATABASE ? AS damaged').run(damagedPath);
    // Rows written under older permission meanings are dropped, as on any open.
    const revision = db
      .prepare('SELECT permission_semantics_revision FROM damaged.session_file_cache_metadata')
      .get()?.permission_semantics_revision;
    if (revision !== PERMISSION_SEMANTICS_REVISION) return;
    const insert = db.prepare(
      `INSERT OR IGNORE INTO session_file_cache (${SALVAGED_COLUMNS})
       VALUES (${SALVAGED_COLUMNS.split(', ')
         .map(() => '?')
         .join(', ')})`,
    );
    const rows = db
      .prepare(`SELECT ${SALVAGED_COLUMNS} FROM damaged.session_file_cache`)
      .iterate() as Iterable<Record<string, SQLInputValue>>;
    // Rows read before a damaged page are kept; the cache revalidates each one.
    for (const row of rows) insert.run(...Object.values(row));
  } catch {
    // Whatever could not be read is gone from the rebuild, not from the copy.
  } finally {
    db.close();
  }
}

function corruptSearchStorageMessage(path: string): string {
  return (
    `History search storage is corrupt. Quit DROIDEX, back up ${path} and its -wal/-shm files, ` +
    'then repair the database or restore a known-good backup. Storage was preserved because ' +
    'missing transcripts cannot reconstruct retained chat summaries.'
  );
}

function isDatabaseCorruption(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const rawCode: unknown = Reflect.get(error, 'code');
  const code = typeof rawCode === 'string' ? rawCode.toLowerCase() : '';
  const message = error.message.toLowerCase();
  return (
    code.includes('corrupt') ||
    code.includes('notadb') ||
    message.includes('database disk image is malformed') ||
    message.includes('file is not a database')
  );
}
