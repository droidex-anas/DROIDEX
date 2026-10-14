import { createHash } from 'node:crypto';
import { lstat, open, realpath } from 'node:fs/promises';
import { isAbsolute, relative, sep } from 'node:path';

import type { OpaqueUsageCursor, OpaqueUsageSourceStore } from './UsageSourceContract.js';
import type { UsageEvent, UsageTokenCounts } from './types.js';

const ADAPTER_NAME = 'droid-settings';
const ADAPTER_VERSION = 2;
const MAX_TOKEN_COUNT = 1_000_000_000_000_000;
const MAX_DATE_MS = 8_640_000_000_000_000;
const AUDIT_INTERVAL_MS = 6 * 60 * 60 * 1_000;
const COUNT_KEYS: (keyof UsageTokenCounts)[] = [
  'inputTokens',
  'outputTokens',
  'cacheWriteTokens',
  'cacheReadTokens',
  'reasoningTokens',
];

class MalformedSettingsError extends Error {}

interface FileState {
  contentHash: string;
  fileIdentity: string;
  fileSize: number;
  mtimeMs: number;
  verifiedAtMs: number;
  generation: number;
  rawBaselines: UsageTokenCounts;
  totals: UsageTokenCounts;
}

interface FileMetadata {
  sourcePath: string;
  sessionId: string;
  fileIdentity: string;
  fileSize: number;
  mtimeMs: number;
}

interface StatMetadata {
  dev: number | bigint;
  ino: number | bigint;
  size: number;
  mtimeMs: number;
}

interface FileObservation extends FileMetadata {
  contentHash: string;
  tsMs: number;
  model: string | null;
  rawTotals: UsageTokenCounts;
  totals: UsageTokenCounts;
  verifiedAtMs: number;
}

export type DroidSettingsFileResult =
  | { kind: 'processed'; discovered: boolean; insertedEvents: number }
  | { kind: 'malformed' | 'oversized' | 'retry' | 'unavailable' };

export async function ingestDroidSettingsFile(
  store: OpaqueUsageSourceStore,
  root: string,
  candidate: string,
  maxFileBytes: number,
  forceRead = false,
): Promise<DroidSettingsFileResult> {
  try {
    const metadata = await readMetadata(root, candidate);
    if (metadata === null) return { kind: 'unavailable' };
    const cursor = store.usageSourceCursor(metadata.sourcePath, ADAPTER_NAME);
    const previous = restoreFileState(cursor, metadata.sourcePath);
    if (
      !forceRead &&
      previous &&
      unchanged(metadata, previous) &&
      !auditDue(previous.verifiedAtMs)
    ) {
      return { kind: 'processed', discovered: false, insertedEvents: 0 };
    }
    const observation = await readStableObservation(metadata, maxFileBytes);
    if (observation === 'oversized') return { kind: 'oversized' };
    if (observation === null) return { kind: 'retry' };
    const replaced =
      previous !== null &&
      (previous.fileIdentity !== observation.fileIdentity ||
        decreased(observation.rawTotals, previous.rawBaselines));
    const generation = replaced ? previous.generation + 1 : (previous?.generation ?? 0);
    const counts = replaced ? observation.totals : delta(observation.totals, previous?.totals);
    const rawBaselines = replaced
      ? observation.rawTotals
      : mergeKnown(previous?.rawBaselines, observation.rawTotals);
    const totals = replaced ? observation.totals : mergeKnown(previous?.totals, observation.totals);
    const event = hasUsage(counts) ? droidEvent(observation, counts, generation) : null;
    const committed = store.ingestUsageSource({
      expectedCursor: cursor,
      nextCursor: {
        sourcePath: observation.sourcePath,
        sourceId: sourceId(observation.sourcePath),
        adapterName: ADAPTER_NAME,
        adapterVersion: ADAPTER_VERSION,
        state: JSON.stringify({
          contentHash: observation.contentHash,
          fileIdentity: observation.fileIdentity,
          fileSize: observation.fileSize,
          mtimeMs: observation.mtimeMs,
          verifiedAtMs: observation.verifiedAtMs,
          generation,
          rawBaselines,
          totals,
        }),
      },
      reset: false,
      events: event ? [event] : [],
    });
    return {
      kind: 'processed',
      discovered: cursor === null,
      insertedEvents: committed.insertedEvents,
    };
  } catch (error) {
    if (isUnavailable(error)) return { kind: 'unavailable' };
    if (error instanceof SyntaxError || error instanceof MalformedSettingsError) {
      return { kind: 'malformed' };
    }
    throw error;
  }
}

async function readStableObservation(
  metadata: FileMetadata,
  maxBytes: number,
): Promise<FileObservation | 'oversized' | null> {
  try {
    return await readObservation(metadata, maxBytes);
  } catch (error) {
    if (!(error instanceof SyntaxError)) throw error;
    await new Promise<void>((resolve) => setImmediate(resolve));
    return await readObservation(metadata, maxBytes);
  }
}

async function readObservation(
  metadata: FileMetadata,
  maxBytes: number,
): Promise<FileObservation | 'oversized' | null> {
  const handle = await open(metadata.sourcePath, 'r');
  try {
    const before = await handle.stat();
    if (!before.isFile()) return null;
    if (before.size > maxBytes) return 'oversized';
    if (!sameMetadata(metadata, before)) return null;
    const bytes = Buffer.alloc(Math.min(maxBytes + 1, before.size + 1));
    let bytesRead = 0;
    while (bytesRead < bytes.length) {
      const read = await handle.read(bytes, bytesRead, bytes.length - bytesRead, bytesRead);
      if (read.bytesRead === 0) break;
      bytesRead += read.bytesRead;
    }
    if (bytesRead > maxBytes) return 'oversized';
    const after = await handle.stat();
    if (
      identity(before) !== identity(after) ||
      before.size !== after.size ||
      before.mtimeMs !== after.mtimeMs
    ) {
      return null;
    }
    const value: unknown = JSON.parse(bytes.subarray(0, bytesRead).toString('utf8'));
    const record = object(value);
    const usage = object(record?.tokenUsage);
    if (!record || !usage) {
      throw new MalformedSettingsError('Droid settings token usage is missing.');
    }
    const tsMs = timestamp(after.mtimeMs);
    if (tsMs === null) {
      throw new MalformedSettingsError('Droid settings metadata is invalid.');
    }
    const model = boundedText(record.model, 160);
    const rawTotals = droidRawCounts(usage);
    const totals = normalizeCounts(rawTotals);
    return {
      ...metadata,
      fileIdentity: identity(after),
      fileSize: after.size,
      mtimeMs: tsMs,
      contentHash: hash(canonicalMetadata(model, rawTotals)),
      tsMs,
      model,
      rawTotals,
      totals,
      verifiedAtMs: timestamp(Date.now()) ?? tsMs,
    };
  } finally {
    await handle.close();
  }
}

async function readMetadata(root: string, candidate: string): Promise<FileMetadata | null> {
  const stats = await lstat(candidate);
  if (!stats.isFile() || stats.isSymbolicLink()) return null;
  const sourcePath = await realpath(candidate);
  if (!inside(root, sourcePath)) return null;
  const mtimeMs = timestamp(stats.mtimeMs);
  if (mtimeMs === null || !Number.isSafeInteger(stats.size) || stats.size < 0) return null;
  return {
    sourcePath,
    sessionId: sourceId(sourcePath),
    fileIdentity: identity(stats),
    fileSize: stats.size,
    mtimeMs,
  };
}

function droidEvent(
  observation: FileObservation,
  counts: UsageTokenCounts,
  generation: number,
): UsageEvent {
  return {
    dedupeKey: `droid-settings:${hash(`${observation.sourcePath}\0${String(generation)}\0${observation.contentHash}`)}`,
    harnessId: 'droid',
    harnessDisplayName: 'Droid',
    sourceId: sourceId(observation.sourcePath),
    sessionId: observation.sessionId,
    project: null,
    sessionStartedAtMs: null,
    tsMs: observation.tsMs,
    model: observation.model,
    serviceTier: null,
    ...counts,
    providerCostMicrousd: null,
    estimatedCostMicrousd: null,
    pricingVersion: null,
  };
}

function droidRawCounts(value: Record<string, unknown>): UsageTokenCounts {
  return {
    inputTokens: count(value.inputTokens),
    outputTokens: count(value.outputTokens),
    cacheWriteTokens: count(value.cacheCreationTokens),
    cacheReadTokens: count(value.cacheReadTokens),
    reasoningTokens: count(value.thinkingTokens),
  };
}

function normalizeCounts(raw: UsageTokenCounts): UsageTokenCounts {
  return {
    inputTokens: completeSum(raw.inputTokens, raw.cacheReadTokens, raw.cacheWriteTokens),
    outputTokens: completeSum(raw.outputTokens, raw.reasoningTokens),
    cacheWriteTokens: raw.cacheWriteTokens,
    cacheReadTokens: raw.cacheReadTokens,
    reasoningTokens: raw.reasoningTokens,
  };
}

function canonicalMetadata(model: string | null, counts: UsageTokenCounts): string {
  return JSON.stringify([
    model,
    counts.inputTokens,
    counts.outputTokens,
    counts.cacheWriteTokens,
    counts.cacheReadTokens,
    counts.reasoningTokens,
  ]);
}

function unchanged(current: FileMetadata, previous: FileState): boolean {
  return (
    current.fileIdentity === previous.fileIdentity &&
    current.fileSize === previous.fileSize &&
    current.mtimeMs === previous.mtimeMs
  );
}

function sameMetadata(current: FileMetadata, stats: StatMetadata): boolean {
  return (
    current.fileIdentity === identity(stats) &&
    current.fileSize === stats.size &&
    current.mtimeMs === timestamp(stats.mtimeMs)
  );
}

function auditDue(verifiedAtMs: number): boolean {
  const now = Date.now();
  return (
    !Number.isSafeInteger(now) || now < verifiedAtMs || now - verifiedAtMs >= AUDIT_INTERVAL_MS
  );
}

function delta(current: UsageTokenCounts, previous?: UsageTokenCounts): UsageTokenCounts {
  if (!previous) return current;
  return mapCounts(current, (key, value) => tokenDelta(value, previous[key]));
}

function mergeKnown(
  previous: UsageTokenCounts | undefined,
  current: UsageTokenCounts,
): UsageTokenCounts {
  if (!previous) return current;
  return mapCounts(current, (key, value) => value ?? previous[key]);
}

function tokenDelta(current: number | null, previous: number | null): number | null {
  if (current === null) return null;
  return previous === null ? current : current - previous;
}

function decreased(current: UsageTokenCounts, previous: UsageTokenCounts): boolean {
  return COUNT_KEYS.some(
    (key) => current[key] !== null && previous[key] !== null && current[key] < previous[key],
  );
}

function mapCounts(
  value: UsageTokenCounts,
  project: (key: keyof UsageTokenCounts, value: number | null) => number | null,
): UsageTokenCounts {
  return {
    inputTokens: project('inputTokens', value.inputTokens),
    outputTokens: project('outputTokens', value.outputTokens),
    cacheWriteTokens: project('cacheWriteTokens', value.cacheWriteTokens),
    cacheReadTokens: project('cacheReadTokens', value.cacheReadTokens),
    reasoningTokens: project('reasoningTokens', value.reasoningTokens),
  };
}

function restoreFileState(cursor: OpaqueUsageCursor | null, sourcePath: string): FileState | null {
  if (!cursor) return null;
  if (
    cursor.adapterVersion !== ADAPTER_VERSION ||
    cursor.sourceId !== sourceId(sourcePath) ||
    cursor.adapterName !== ADAPTER_NAME
  ) {
    throw cursorError(sourcePath);
  }
  const value = parseObject(cursor.state);
  const rawTotals = object(value?.rawBaselines);
  const totals = object(value?.totals);
  const restoredRaw = rawTotals ? restoreCounts(rawTotals) : null;
  const restored = totals ? restoreCounts(totals) : null;
  if (
    typeof value?.contentHash === 'string' &&
    /^[a-f0-9]{64}$/.test(value.contentHash) &&
    typeof value.fileIdentity === 'string' &&
    value.fileIdentity.length <= 128 &&
    validNonnegativeInteger(value.fileSize) &&
    validTimestamp(value.mtimeMs) &&
    validTimestamp(value.verifiedAtMs) &&
    Number.isSafeInteger(value.generation) &&
    Number(value.generation) >= 0 &&
    restoredRaw &&
    restored
  ) {
    return {
      contentHash: value.contentHash,
      fileIdentity: value.fileIdentity,
      fileSize: Number(value.fileSize),
      mtimeMs: Number(value.mtimeMs),
      verifiedAtMs: Number(value.verifiedAtMs),
      generation: Number(value.generation),
      rawBaselines: restoredRaw,
      totals: restored,
    };
  }
  throw cursorError(sourcePath);
}

function completeSum(...values: (number | null)[]): number | null {
  if (values.includes(null)) return null;
  const total = values.reduce<number>((sum, value) => sum + (value ?? 0), 0);
  return Number.isSafeInteger(total) && total <= MAX_TOKEN_COUNT ? total : null;
}

function restoreCounts(value: Record<string, unknown>): UsageTokenCounts | null {
  if (COUNT_KEYS.some((key) => value[key] !== null && count(value[key]) === null)) return null;
  return {
    inputTokens: count(value.inputTokens),
    outputTokens: count(value.outputTokens),
    cacheWriteTokens: count(value.cacheWriteTokens),
    cacheReadTokens: count(value.cacheReadTokens),
    reasoningTokens: count(value.reasoningTokens),
  };
}

function count(value: unknown): number | null {
  return Number.isSafeInteger(value) && Number(value) >= 0 && Number(value) <= MAX_TOKEN_COUNT
    ? Number(value)
    : null;
}

function hasUsage(value: UsageTokenCounts): boolean {
  return COUNT_KEYS.some((key) => (value[key] ?? 0) > 0);
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

function timestamp(value: number): number | null {
  const rounded = Math.trunc(value);
  return Number.isSafeInteger(rounded) && rounded >= 0 && rounded <= MAX_DATE_MS ? rounded : null;
}

function validNonnegativeInteger(value: unknown): boolean {
  return Number.isSafeInteger(value) && Number(value) >= 0;
}

function validTimestamp(value: unknown): boolean {
  return validNonnegativeInteger(value) && Number(value) <= MAX_DATE_MS;
}

function identity(stats: { dev: number | bigint; ino: number | bigint }): string {
  return `${String(stats.dev)}:${String(stats.ino)}`;
}

function sourceId(path: string): string {
  return `droid-settings:${hash(path)}`;
}

function hash(value: string | Uint8Array): string {
  return createHash('sha256').update(value).digest('hex');
}

function inside(root: string, candidate: string): boolean {
  const child = relative(root, candidate);
  return child !== '' && child !== '..' && !child.startsWith(`..${sep}`) && !isAbsolute(child);
}

function cursorError(sourcePath: string): Error {
  return new Error(
    `Droid settings cursor for ${sourcePath} is incompatible. Back up and remove usage.sqlite, then restart DROIDEX to rebuild it.`,
  );
}

function isUnavailable(error: unknown): boolean {
  return (
    error instanceof Error &&
    'code' in error &&
    ['ENOENT', 'ENOTDIR', 'EACCES', 'EPERM'].includes(String(error.code))
  );
}
