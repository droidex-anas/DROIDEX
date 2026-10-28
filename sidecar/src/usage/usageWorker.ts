import { parentPort, workerData } from 'node:worker_threads';
import { watch, type FSWatcher } from 'node:fs';

import { DroidSettingsIngest, type DroidSettingsReconcileResult } from './DroidSettingsIngest.js';
import {
  OpenCodeIngest,
  openCodeDataRoots,
  type OpenCodeReconcileResult,
} from './OpenCodeIngest.js';
import { UsageDatabase } from './UsageDatabase.js';
import { UsageIngest, type UsageReconcileResult, type UsageSourceRoot } from './UsageIngest.js';
import {
  serializeUsageWorkerError,
  type UsageSyncState,
  type UsageSyncStatus,
  type UsageWorkerData,
  type UsageWorkerEnvelope,
  type UsageWorkerReconcileResult,
  type UsageWorkerResponse,
} from './UsageWorkerProtocol.js';

const RETRY_DELAY_MS = 60_000;
const data = validWorkerData(workerData);
if (!parentPort || !data) throw new Error('Usage worker requires a parent port and database path.');
const openCodeRoots = data.openCodeRoots ?? openCodeDataRoots();

const database = new UsageDatabase({
  databasePath: data.databasePath,
  ...(data.timeZone ? { timeZone: data.timeZone } : {}),
});
const sourceState: UsageSyncStatus['sources'] = {
  jsonl: 'indexing',
  openCode: 'indexing',
  droid: 'indexing',
};
let closed = false;
let jsonlReady = false;
let jsonlBackground: Promise<void> | null = null;
let jsonlRetryTimer: NodeJS.Timeout | null = null;
let openCodeBackground: Promise<void> | null = null;
let openCodeInFlight: Promise<OpenCodeReconcileResult> | null = null;
let openCodeTimer: NodeJS.Timeout | null = null;
let openCodeWakeTimer: NodeJS.Timeout | null = null;
let openCodeWakeGeneration = 0;
const openCodeWatchers = new Map<string, FSWatcher>();
let droidBackground: Promise<void> | null = null;
let droidInFlight: Promise<DroidSettingsReconcileResult> | null = null;
let droidTimer: NodeJS.Timeout | null = null;
let droidWakeGeneration = 0;

const ingest = new UsageIngest({
  database,
  ...(data.roots ? { roots: data.roots } : {}),
  onError: () => {
    sourceFailed('jsonl');
    scheduleJsonlRetry();
  },
  onReconciled: () => {
    if (jsonlReady && !closed) sourceState.jsonl = 'ready';
  },
});
const openCode = new OpenCodeIngest({
  store: database,
  ...(data.openCodeRoots ? { roots: data.openCodeRoots } : {}),
});
const droid = new DroidSettingsIngest({
  store: database,
  ...(data.droidSettingsRoots ? { roots: data.droidSettingsRoots } : {}),
  onDirty: wakeDroid,
});
let tail = Promise.resolve();

startJsonl();
startOpenCodeDrain();
startDroidDrain();

parentPort.on('message', (envelope: UsageWorkerEnvelope) => {
  tail = tail.then(
    () => handle(envelope),
    () => handle(envelope),
  );
  void tail.catch(() => {
    console.error('Usage worker operation failed.');
  });
});

async function handle(envelope: UsageWorkerEnvelope): Promise<void> {
  const { request, replyPort } = envelope;
  try {
    if (closed && request.type !== 'close') throw new Error('Usage worker is closed.');
    if (request.type === 'close') {
      await close();
      reply(replyPort, { ok: true, value: { closed: true } });
      return;
    }
    if (request.type === 'reconcile') {
      reply(replyPort, { ok: true, value: await reconcileOnce() });
      return;
    }
    if (request.type === 'record-droidex-sessions') {
      reply(replyPort, { ok: true, value: database.recordDroidexSessions(request.ids) });
      return;
    }
    reply(replyPort, {
      ok: true,
      value: { ...database.snapshot(), sync: syncStatus() },
    });
  } catch (error) {
    reply(replyPort, serializeUsageWorkerError(error));
  }
}

async function reconcileOnce(): Promise<UsageWorkerReconcileResult> {
  const results = await Promise.allSettled([
    reconcileJsonl(),
    reconcileOpenCode(),
    reconcileDroid(),
  ] as const);
  const [jsonl, openCodeResult, droidResult] = results;
  if (
    jsonl.status === 'rejected' ||
    openCodeResult.status === 'rejected' ||
    droidResult.status === 'rejected'
  ) {
    throw new Error('One or more usage sources failed to reconcile.');
  }
  return {
    jsonl: jsonl.value,
    openCode: openCodeResult.value,
    droidSettings: droidResult.value,
  };
}

function startJsonl(): void {
  if (closed || jsonlBackground) return;
  clearJsonlTimer();
  if (!jsonlReady) sourceState.jsonl = 'indexing';
  const operation = ingest
    .start()
    .then(() => {
      if (closed) return;
      jsonlReady = true;
      sourceState.jsonl = 'ready';
    })
    .catch(() => {
      sourceFailed('jsonl');
      scheduleJsonlRetry();
    })
    .finally(() => {
      if (jsonlBackground === operation) jsonlBackground = null;
    });
  jsonlBackground = operation;
}

async function reconcileJsonl(): Promise<UsageReconcileResult> {
  try {
    const result = await ingest.reconcile();
    if (jsonlReady) sourceState.jsonl = 'ready';
    else {
      sourceState.jsonl = 'indexing';
      startJsonl();
    }
    return result;
  } catch (error) {
    sourceFailed('jsonl');
    scheduleJsonlRetry();
    throw error;
  }
}

function scheduleJsonlRetry(): void {
  if (closed || jsonlRetryTimer) return;
  jsonlRetryTimer = setTimeout(() => {
    jsonlRetryTimer = null;
    if (jsonlReady) void reconcileJsonl().catch(() => undefined);
    else startJsonl();
  }, RETRY_DELAY_MS);
  jsonlRetryTimer.unref();
}

function startOpenCodeDrain(): void {
  if (closed || openCodeBackground) return;
  if (openCodeWakeTimer) clearTimeout(openCodeWakeTimer);
  openCodeWakeTimer = null;
  clearOpenCodeTimer();
  const operation = drainOpenCode().finally(() => {
    if (openCodeBackground === operation) openCodeBackground = null;
  });
  openCodeBackground = operation;
}

async function drainOpenCode(): Promise<void> {
  ensureOpenCodeWatchers();
  try {
    let result: OpenCodeReconcileResult;
    let more: boolean;
    do {
      const wakeAtStart = openCodeWakeGeneration;
      result = await openCodePass();
      more = result.backlog || wakeAtStart !== openCodeWakeGeneration;
      if (more && !closed) {
        sourceState.openCode = 'indexing';
        await yieldToEventLoop();
      }
    } while (more && !closed);
    if (!closed) {
      sourceState.openCode = 'ready';
      scheduleOpenCode(RETRY_DELAY_MS);
    }
  } catch {
    sourceFailed('openCode');
    scheduleOpenCode(RETRY_DELAY_MS);
  }
}

function ensureOpenCodeWatchers(): void {
  for (const root of openCodeRoots) {
    if (openCodeWatchers.has(root)) continue;
    try {
      const watcher = watch(root, (_event, filename) => {
        if (filename && !/\.db(?:-wal|-shm)?$/.test(filename)) return;
        openCodeWakeGeneration += 1;
        if (openCodeBackground || openCodeWakeTimer) return;
        clearOpenCodeTimer();
        openCodeWakeTimer = setTimeout(() => {
          openCodeWakeTimer = null;
          startOpenCodeDrain();
        }, 250);
        openCodeWakeTimer.unref();
      });
      watcher.unref();
      watcher.on('error', () => {
        watcher.close();
        openCodeWatchers.delete(root);
      });
      openCodeWatchers.set(root, watcher);
    } catch {
      // Scheduled discovery also retries roots that do not exist at startup.
    }
  }
}

async function reconcileOpenCode(): Promise<OpenCodeReconcileResult> {
  try {
    const result = await openCodePass();
    if (result.backlog) {
      sourceState.openCode = 'indexing';
      startOpenCodeDrain();
    } else {
      sourceState.openCode = 'ready';
      scheduleOpenCode(RETRY_DELAY_MS);
    }
    return result;
  } catch (error) {
    sourceFailed('openCode');
    scheduleOpenCode(RETRY_DELAY_MS);
    throw error;
  }
}

function openCodePass(): Promise<OpenCodeReconcileResult> {
  if (closed) return Promise.reject(new Error('Usage worker is closed.'));
  if (openCodeInFlight) return openCodeInFlight;
  clearOpenCodeTimer();
  const operation = openCode.reconcile().finally(() => {
    if (openCodeInFlight === operation) openCodeInFlight = null;
  });
  openCodeInFlight = operation;
  return operation;
}

function scheduleOpenCode(delayMs: number): void {
  if (closed || openCodeTimer) return;
  openCodeTimer = setTimeout(() => {
    openCodeTimer = null;
    startOpenCodeDrain();
  }, delayMs);
  openCodeTimer.unref();
}

function startDroidDrain(): void {
  if (closed || droidBackground) return;
  clearDroidTimer();
  const operation = drainDroid().finally(() => {
    if (droidBackground === operation) droidBackground = null;
  });
  droidBackground = operation;
}

async function drainDroid(): Promise<void> {
  try {
    let result: DroidSettingsReconcileResult;
    let more: boolean;
    do {
      const wakeAtStart = droidWakeGeneration;
      result = await droidPass();
      more = result.backlog || droidWasWoken(wakeAtStart);
      if (more && !closed) {
        sourceState.droid = 'indexing';
        await yieldToEventLoop();
      }
    } while (more && !closed);
    if (!closed) {
      sourceState.droid = 'ready';
      scheduleDroid(RETRY_DELAY_MS);
    }
  } catch {
    sourceFailed('droid');
    scheduleDroid(RETRY_DELAY_MS);
  }
}

function wakeDroid(): void {
  if (closed) return;
  droidWakeGeneration += 1;
  startDroidDrain();
}

function droidWasWoken(generation: number): boolean {
  return generation !== droidWakeGeneration;
}

async function reconcileDroid(): Promise<DroidSettingsReconcileResult> {
  try {
    const result = await droidPass();
    if (result.backlog) {
      sourceState.droid = 'indexing';
      startDroidDrain();
    } else {
      sourceState.droid = 'ready';
      scheduleDroid(RETRY_DELAY_MS);
    }
    return result;
  } catch (error) {
    sourceFailed('droid');
    scheduleDroid(RETRY_DELAY_MS);
    throw error;
  }
}

function droidPass(): Promise<DroidSettingsReconcileResult> {
  if (closed) return Promise.reject(new Error('Usage worker is closed.'));
  if (droidInFlight) return droidInFlight;
  clearDroidTimer();
  const operation = droid.reconcile().finally(() => {
    if (droidInFlight === operation) droidInFlight = null;
  });
  droidInFlight = operation;
  return operation;
}

function scheduleDroid(delayMs: number): void {
  if (closed || droidTimer) return;
  droidTimer = setTimeout(() => {
    droidTimer = null;
    startDroidDrain();
  }, delayMs);
  droidTimer.unref();
}

function sourceFailed(source: keyof UsageSyncStatus['sources']): void {
  if (closed) return;
  sourceState[source] = 'error';
  console.error(`Usage ${source} reconciliation failed.`);
}

function syncStatus(): UsageSyncStatus {
  const sources = { ...sourceState };
  return {
    status: overallStatus(Object.values(sources)),
    sources,
  };
}

function overallStatus(states: readonly UsageSyncState[]): UsageSyncState {
  if (states.includes('error')) return 'error';
  return states.includes('indexing') ? 'indexing' : 'ready';
}

async function close(): Promise<void> {
  if (closed) return;
  closed = true;
  clearJsonlTimer();
  clearOpenCodeTimer();
  if (openCodeWakeTimer) clearTimeout(openCodeWakeTimer);
  openCodeWakeTimer = null;
  clearDroidTimer();
  for (const watcher of openCodeWatchers.values()) watcher.close();
  openCodeWatchers.clear();
  await Promise.allSettled([
    ingest.close(),
    jsonlBackground,
    openCodeBackground,
    openCodeInFlight,
    droidBackground,
    droidInFlight,
  ]);
  droid.close();
  database.close();
}

function clearJsonlTimer(): void {
  if (!jsonlRetryTimer) return;
  clearTimeout(jsonlRetryTimer);
  jsonlRetryTimer = null;
}

function clearOpenCodeTimer(): void {
  if (!openCodeTimer) return;
  clearTimeout(openCodeTimer);
  openCodeTimer = null;
}

function clearDroidTimer(): void {
  if (!droidTimer) return;
  clearTimeout(droidTimer);
  droidTimer = null;
}

function yieldToEventLoop(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

function reply(port: UsageWorkerEnvelope['replyPort'], response: UsageWorkerResponse): void {
  try {
    port.postMessage(response);
  } finally {
    port.close();
  }
}

function validWorkerData(value: unknown): UsageWorkerData | null {
  if (
    !isRecord(value) ||
    typeof value.databasePath !== 'string' ||
    value.databasePath.length === 0
  ) {
    return null;
  }
  const result: UsageWorkerData = { databasePath: value.databasePath };
  if (value.timeZone !== undefined) {
    if (typeof value.timeZone !== 'string') return null;
    result.timeZone = value.timeZone;
  }
  if (value.roots !== undefined) {
    const roots = validRoots(value.roots);
    if (!roots) return null;
    result.roots = roots;
  }
  if (value.openCodeRoots !== undefined) {
    const roots = validPaths(value.openCodeRoots);
    if (!roots) return null;
    result.openCodeRoots = roots;
  }
  if (value.droidSettingsRoots !== undefined) {
    const roots = validPaths(value.droidSettingsRoots);
    if (!roots) return null;
    result.droidSettingsRoots = roots;
  }
  return result;
}

function validPaths(value: unknown): string[] | null {
  if (!Array.isArray(value) || value.length > 32) return null;
  return value.every((path) => typeof path === 'string' && path.length > 0 && path.length <= 4_096)
    ? value
    : null;
}

function validRoots(value: unknown): UsageSourceRoot[] | null {
  if (!Array.isArray(value) || value.length > 32) return null;
  const roots: UsageSourceRoot[] = [];
  for (const entry of value) {
    if (!isRecord(entry) || typeof entry.path !== 'string' || entry.path.length === 0) return null;
    if (entry.parserName !== 'claude-code' && entry.parserName !== 'codex') return null;
    roots.push({ parserName: entry.parserName, path: entry.path });
  }
  return roots;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
