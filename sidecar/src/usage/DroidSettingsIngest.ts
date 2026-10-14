import { createHash } from 'node:crypto';
import { watch, type FSWatcher } from 'node:fs';
import { lstat, realpath } from 'node:fs/promises';
import { homedir } from 'node:os';
import { basename, isAbsolute, join, normalize, relative, resolve, sep } from 'node:path';

import {
  readDroidSettingsDirectoryPage,
  safeDroidSettingsDirectory,
} from './DroidSettingsDirectory.js';
import { ingestDroidSettingsFile, type DroidSettingsFileResult } from './DroidSettingsFile.js';
import type { OpaqueUsageCursor, OpaqueUsageSourceStore } from './UsageSourceContract.js';

const DISCOVERY_ADAPTER = 'droid-settings-discovery';
const ADAPTER_VERSION = 1;
const DEFAULT_MAX_FILES = 4_096;
const DEFAULT_MAX_FILE_BYTES = 1_048_576;
const MAX_ROOTS = 32;
const MAX_DISCOVERY_DIRECTORIES = 1_024;
const MAX_DISCOVERY_STATE_BYTES = 64 * 1_024;
const MAX_DIRECTORIES_PER_RECONCILE = 32;
const MAX_DIRTY_FILES = 4_096;
const SETTINGS_SUFFIX = '.settings.json';
const RETRY_BASE_DELAY_MS = 1_000;
const RETRY_MAX_DELAY_MS = 60_000;

export interface DroidSettingsIngestOptions {
  store: OpaqueUsageSourceStore;
  roots?: readonly string[];
  homeDir?: string;
  maxFilesPerReconcile?: number;
  maxFileBytes?: number;
  onDirty?: () => void;
}

export interface DroidSettingsReconcileResult {
  discoveredFiles: number;
  processedFiles: number;
  insertedEvents: number;
  malformedFiles: number;
  oversizedFiles: number;
  unavailableSources: number;
  backlog: boolean;
}

interface DiscoveryState {
  initialComplete: boolean;
  directories: string[];
  directoryIndex: number;
  afterFile: string | null;
}

interface DirtyFile {
  root: string;
  path: string;
  retry: boolean;
  attempts: number;
  notBefore: number;
}

type SettingsFileIngest = typeof ingestDroidSettingsFile;
interface DroidSettingsIngestDependencies {
  ingestFile: SettingsFileIngest;
  now: () => number;
}

/** Incrementally projects Factory Droid's mutable per-session settings into the event ledger. */
export class DroidSettingsIngest {
  private readonly roots: string[];
  private readonly maxFiles: number;
  private readonly maxFileBytes: number;
  private readonly startupRoots: Set<string>;
  private readonly startupResetRoots: Set<string>;
  private readonly watchers = new Map<string, FSWatcher>();
  private readonly dirtyFiles = new Map<string, DirtyFile>();
  private readonly ingestFile: SettingsFileIngest;
  private readonly now: () => number;
  private retryTimer: NodeJS.Timeout | null = null;

  constructor(
    private readonly options: DroidSettingsIngestOptions,
    dependencies: Partial<DroidSettingsIngestDependencies> = {},
  ) {
    this.ingestFile = dependencies.ingestFile ?? ingestDroidSettingsFile;
    this.now = dependencies.now ?? Date.now;
    this.roots = normalizeRoots(options.roots ?? droidSettingsRoots(options.homeDir ?? homedir()));
    this.maxFiles = boundedInteger(
      options.maxFilesPerReconcile ?? DEFAULT_MAX_FILES,
      'files',
      4_096,
    );
    this.maxFileBytes = boundedInteger(
      options.maxFileBytes ?? DEFAULT_MAX_FILE_BYTES,
      'file bytes',
      DEFAULT_MAX_FILE_BYTES,
    );
    if (this.roots.length > 0 && this.roots.length >= this.maxFiles) {
      throw new Error('Droid settings file budget must exceed the configured root count.');
    }
    this.startupRoots = new Set(this.roots);
    this.startupResetRoots = new Set(this.roots);
  }

  async reconcile(): Promise<DroidSettingsReconcileResult> {
    const dirty = await this.drainDirtyFiles(this.maxFiles - this.roots.length);
    const result = dirty.result;
    if (this.roots.length === 0) return result;
    let remaining = this.maxFiles - dirty.visited;
    for (const [rootIndex, configuredRoot] of this.roots.entries()) {
      if (remaining === 0) break;
      const rootsLeft = this.roots.length - rootIndex;
      const budget = Math.max(1, Math.floor(remaining / rootsLeft));
      try {
        const scanned = await this.scanRoot(configuredRoot, budget);
        addResult(result, scanned);
      } catch (error) {
        if (!isUnavailable(error)) throw error;
        this.startupRoots.delete(configuredRoot);
        this.startupResetRoots.delete(configuredRoot);
        result.unavailableSources += 1;
      }
      remaining -= budget;
    }
    result.backlog ||= this.hasReadyDirtyFile();
    this.scheduleRetryWake();
    return result;
  }

  close(): void {
    for (const watcher of this.watchers.values()) watcher.close();
    this.watchers.clear();
    this.dirtyFiles.clear();
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.retryTimer = null;
  }

  private async scanRoot(
    configuredRoot: string,
    budget: number,
  ): Promise<DroidSettingsReconcileResult> {
    const result = emptyResult();
    const rootStats = await lstat(configuredRoot);
    if (!rootStats.isDirectory() || rootStats.isSymbolicLink()) {
      this.startupRoots.delete(configuredRoot);
      this.startupResetRoots.delete(configuredRoot);
      return result;
    }
    const root = await realpath(configuredRoot);
    const discoveryCursor = this.options.store.usageSourceCursor(root, DISCOVERY_ADAPTER);
    const restored = restoreDiscovery(discoveryCursor, root);
    const startupSweep = this.startupRoots.has(configuredRoot);
    const resetStartup = this.startupResetRoots.delete(configuredRoot);
    const state = resetStartup ? initialDiscoveryState(restored.initialComplete) : restored;
    const directories = [...state.directories];
    let directoryIndex = state.directoryIndex;
    let afterFile = state.afterFile;
    let remaining = budget;
    let remainingDirectories = MAX_DIRECTORIES_PER_RECONCILE;
    let more = directoryIndex < directories.length;
    let foundNew = false;

    while (more && remaining > 0 && remainingDirectories > 0) {
      const relativeDirectory = directories[directoryIndex];
      remainingDirectories -= 1;
      let page: Awaited<ReturnType<typeof readDroidSettingsDirectoryPage>>;
      try {
        page = await readDroidSettingsDirectoryPage(
          root,
          relativeDirectory,
          afterFile,
          remaining,
          MAX_DISCOVERY_DIRECTORIES,
        );
      } catch (error) {
        if (!isUnavailable(error) || relativeDirectory === '') throw error;
        result.unavailableSources += 1;
        directoryIndex += 1;
        afterFile = null;
        more = directoryIndex < directories.length;
        continue;
      }
      if (!page) {
        result.unavailableSources += 1;
        directoryIndex += 1;
        afterFile = null;
        more = directoryIndex < directories.length;
        continue;
      }
      appendDirectories(directories, relativeDirectory, page.directories);
      await this.ensureWatcher(root, relativeDirectory);
      for (const name of page.files) {
        const path = join(root, relativeDirectory, name);
        const queued = this.dirtyFiles.get(path);
        if (queued?.retry) {
          remaining -= 1;
          afterFile = name;
          continue;
        }
        if (queued) this.dirtyFiles.delete(path);
        const processed = await this.ingestFile(this.options.store, root, path, this.maxFileBytes);
        if (processed.kind === 'retry') {
          this.queueRetry(root, path, 0);
          remaining -= 1;
          afterFile = name;
          continue;
        }
        remaining -= 1;
        result.processedFiles += processed.kind === 'processed' ? 1 : 0;
        result.malformedFiles += processed.kind === 'malformed' ? 1 : 0;
        result.oversizedFiles += processed.kind === 'oversized' ? 1 : 0;
        result.unavailableSources += processed.kind === 'unavailable' ? 1 : 0;
        if (processed.kind === 'processed') {
          result.insertedEvents += processed.insertedEvents;
          if (processed.discovered) {
            result.discoveredFiles += 1;
            foundNew = true;
          }
        }
        afterFile = name;
      }
      if (page.moreFiles) break;
      directoryIndex += 1;
      afterFile = null;
      more = directoryIndex < directories.length;
    }

    const nextState: DiscoveryState = more
      ? { ...state, directories, directoryIndex, afterFile }
      : initialDiscoveryState(true);
    commitDiscovery(this.options.store, root, discoveryCursor, nextState);
    if (!more) {
      this.startupRoots.delete(configuredRoot);
    }
    result.backlog ||= more && (startupSweep || !state.initialComplete || foundNew);
    return result;
  }

  private async drainDirtyFiles(limit: number): Promise<{
    result: DroidSettingsReconcileResult;
    visited: number;
  }> {
    const result = emptyResult();
    let visited = 0;
    for (const [key, dirty] of this.dirtyFiles) {
      if (visited === limit) break;
      if (dirty.notBefore > this.now()) continue;
      this.dirtyFiles.delete(key);
      const processed = await this.ingestFile(
        this.options.store,
        dirty.root,
        dirty.path,
        this.maxFileBytes,
        true,
      );
      visited += 1;
      if (processed.kind === 'retry') {
        this.queueRetry(dirty.root, dirty.path, dirty.attempts + 1);
        continue;
      }
      addFileResult(result, processed);
    }
    return { result, visited };
  }

  private async ensureWatcher(root: string, relativeDirectory: string): Promise<void> {
    let directory: string | null;
    try {
      directory = await safeDroidSettingsDirectory(root, relativeDirectory);
    } catch (error) {
      if (isUnavailable(error)) return;
      throw error;
    }
    if (!directory) return;
    if (this.watchers.has(directory)) return;
    try {
      const watcher = watch(directory, (_event, filename) => {
        if (!filename) return;
        const name = filename;
        if (basename(name) !== name || !name.endsWith(SETTINGS_SUFFIX)) return;
        const path = resolve(directory, name);
        if (
          !insideRoot(root, path) ||
          (!this.dirtyFiles.has(path) && this.dirtyFiles.size >= MAX_DIRTY_FILES)
        ) {
          return;
        }
        if (this.dirtyFiles.get(path)?.retry) return;
        this.dirtyFiles.set(path, { root, path, retry: false, attempts: 0, notBefore: 0 });
        this.options.onDirty?.();
      });
      watcher.on('error', () => {
        watcher.close();
        this.watchers.delete(directory);
      });
      watcher.unref();
      this.watchers.set(directory, watcher);
    } catch {
      // Periodic bounded discovery remains authoritative when watch is unavailable.
    }
  }

  private queueRetry(root: string, path: string, attempts: number): void {
    if (!this.dirtyFiles.has(path) && this.dirtyFiles.size >= MAX_DIRTY_FILES) return;
    const delay =
      attempts === 0
        ? 0
        : Math.min(RETRY_BASE_DELAY_MS * 2 ** Math.min(attempts - 1, 10), RETRY_MAX_DELAY_MS);
    this.dirtyFiles.set(path, {
      root,
      path,
      retry: true,
      attempts,
      notBefore: this.now() + delay,
    });
  }

  private hasReadyDirtyFile(): boolean {
    const now = this.now();
    for (const dirty of this.dirtyFiles.values()) if (dirty.notBefore <= now) return true;
    return false;
  }

  private scheduleRetryWake(): void {
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.retryTimer = null;
    let next = Number.POSITIVE_INFINITY;
    for (const dirty of this.dirtyFiles.values()) next = Math.min(next, dirty.notBefore);
    if (!Number.isFinite(next) || next <= this.now()) return;
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      this.options.onDirty?.();
    }, next - this.now());
    this.retryTimer.unref();
  }
}

export function droidSettingsRoots(homeDir = homedir()): string[] {
  return [resolve(homeDir, '.factory/sessions')];
}

function restoreDiscovery(cursor: OpaqueUsageCursor | null, root: string): DiscoveryState {
  if (!cursor) return initialDiscoveryState(false);
  if (
    cursor.adapterVersion !== ADAPTER_VERSION ||
    cursor.adapterName !== DISCOVERY_ADAPTER ||
    cursor.sourceId !== `droid-settings-discovery:${hash(root)}`
  ) {
    throw cursorError(root);
  }
  const value = parseObject(cursor.state);
  const directories = Array.isArray(value?.directories) ? value.directories : null;
  const directoryIndex = value?.directoryIndex;
  const afterFile = nullableBoundedText(value?.afterFile, 255);
  if (
    typeof value?.initialComplete !== 'boolean' ||
    !directories ||
    !validDirectories(directories) ||
    !Number.isSafeInteger(directoryIndex) ||
    Number(directoryIndex) < 0 ||
    Number(directoryIndex) >= directories.length ||
    afterFile === undefined
  ) {
    throw cursorError(root);
  }
  return {
    initialComplete: value.initialComplete,
    directories,
    directoryIndex: Number(directoryIndex),
    afterFile,
  };
}

function commitDiscovery(
  store: OpaqueUsageSourceStore,
  root: string,
  cursor: OpaqueUsageCursor | null,
  state: DiscoveryState,
): void {
  const serialized = serializeDiscovery(state);
  if (cursor?.state === serialized) return;
  store.ingestUsageSource({
    expectedCursor: cursor,
    nextCursor: {
      sourcePath: root,
      sourceId: `droid-settings-discovery:${hash(root)}`,
      adapterName: DISCOVERY_ADAPTER,
      adapterVersion: ADAPTER_VERSION,
      state: serialized,
    },
    reset: false,
    events: [],
  });
}

function appendDirectories(directories: string[], parent: string, names: readonly string[]): void {
  const known = new Set(directories);
  const discovered = names
    .map((name) => (parent ? join(parent, name) : name))
    .filter((path) => !known.has(path))
    .sort();
  if (directories.length + discovered.length > MAX_DISCOVERY_DIRECTORIES) {
    throw new Error('Droid settings directory count exceeds the discovery limit.');
  }
  directories.push(...discovered);
}

function initialDiscoveryState(initialComplete: boolean): DiscoveryState {
  return { initialComplete, directories: [''], directoryIndex: 0, afterFile: null };
}

function validDirectories(value: unknown[]): value is string[] {
  return (
    value.length > 0 &&
    value.length <= MAX_DISCOVERY_DIRECTORIES &&
    value[0] === '' &&
    new Set(value).size === value.length &&
    value.every(
      (directory) =>
        typeof directory === 'string' &&
        directory.length <= 1_024 &&
        (directory === '' ||
          (!isAbsolute(directory) &&
            directory !== '..' &&
            !directory.startsWith(`..${sep}`) &&
            normalize(directory) === directory)),
    )
  );
}

function serializeDiscovery(state: DiscoveryState): string {
  const serialized = JSON.stringify(state);
  if (Buffer.byteLength(serialized) > MAX_DISCOVERY_STATE_BYTES) {
    throw new Error('Droid settings discovery cursor exceeds 64 KiB.');
  }
  return serialized;
}

function insideRoot(root: string, candidate: string): boolean {
  const child = relative(root, candidate);
  return child !== '' && child !== '..' && !child.startsWith(`..${sep}`) && !isAbsolute(child);
}

function normalizeRoots(roots: readonly string[]): string[] {
  if (roots.length > MAX_ROOTS) throw new Error('Too many Droid settings roots.');
  return [...new Set(roots.map((root) => resolve(root)))].sort();
}

function object(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function parseObject(value: string): Record<string, unknown> | null {
  try {
    return object(JSON.parse(value));
  } catch {
    return null;
  }
}

function boundedText(value: unknown, max: number): string | null {
  return typeof value === 'string' &&
    value.length > 0 &&
    value.length <= max &&
    !value.includes('\0')
    ? value
    : null;
}

function nullableBoundedText(value: unknown, max: number): string | null | undefined {
  return value === null ? null : (boundedText(value, max) ?? undefined);
}

function hash(value: string | Uint8Array): string {
  return createHash('sha256').update(value).digest('hex');
}

function cursorError(root: string): Error {
  return new Error(
    `Droid settings cursor for ${root} is incompatible. Back up and remove usage.sqlite, then restart DROIDEX to rebuild it.`,
  );
}

function boundedInteger(value: number, name: string, maximum: number): number {
  if (!Number.isSafeInteger(value) || value <= 0 || value > maximum) {
    throw new Error(`Droid settings ${name} must be between 1 and ${String(maximum)}.`);
  }
  return value;
}

function isUnavailable(error: unknown): boolean {
  return (
    error instanceof Error &&
    'code' in error &&
    ['ENOENT', 'ENOTDIR', 'EACCES', 'EPERM'].includes(String(error.code))
  );
}

function emptyResult(): DroidSettingsReconcileResult {
  return {
    discoveredFiles: 0,
    processedFiles: 0,
    insertedEvents: 0,
    malformedFiles: 0,
    oversizedFiles: 0,
    unavailableSources: 0,
    backlog: false,
  };
}

function addResult(
  target: DroidSettingsReconcileResult,
  source: DroidSettingsReconcileResult,
): void {
  target.discoveredFiles += source.discoveredFiles;
  target.processedFiles += source.processedFiles;
  target.insertedEvents += source.insertedEvents;
  target.malformedFiles += source.malformedFiles;
  target.oversizedFiles += source.oversizedFiles;
  target.unavailableSources += source.unavailableSources;
  target.backlog ||= source.backlog;
}

function addFileResult(result: DroidSettingsReconcileResult, file: DroidSettingsFileResult): void {
  result.processedFiles += file.kind === 'processed' ? 1 : 0;
  result.malformedFiles += file.kind === 'malformed' ? 1 : 0;
  result.oversizedFiles += file.kind === 'oversized' ? 1 : 0;
  result.unavailableSources += file.kind === 'unavailable' ? 1 : 0;
  if (file.kind !== 'processed') return;
  result.insertedEvents += file.insertedEvents;
  result.discoveredFiles += file.discovered ? 1 : 0;
}
