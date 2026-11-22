import { createHash } from 'node:crypto';
import { constants, type Stats } from 'node:fs';
import { lstat, open, realpath, type FileHandle } from 'node:fs/promises';
import { isAbsolute, relative, resolve, sep } from 'node:path';

import type { UsageDatabase, UsageCursorAdvance } from './UsageDatabase.js';
import type { UsageSourceFile } from './UsageDiscovery.js';
import { createUsageParserState, parseUsageRecord } from './parsers.js';
import type { UsageEvent, UsageParserName, UsageParserState } from './types.js';
import { restoreUsageParserState } from './types.js';

const DEFAULT_MAX_RECORD_BYTES = 1024 * 1024;

export class UsageIngestResetRequiredError extends Error {
  constructor(readonly sourceId: string) {
    super(`Usage source ${sourceId} requires a local ledger reset and rebuild.`);
  }
}

export async function ingestUsageFile(
  file: UsageSourceFile,
  database: Pick<UsageDatabase, 'cursor' | 'ingest'>,
) {
  const candidate = await lstat(file.path);
  if (candidate.isSymbolicLink() || !candidate.isFile()) return null;
  const candidateId = sourceId(file.parserName, file.path);
  const parserState = createUsageParserState(file.parserName);
  const candidateCursor = database.cursor(file.path);
  if (isUnchangedCompleteFile(candidateCursor, candidate, candidateId, parserState)) return null;

  const canonicalPath = await realpath(file.path);
  if (!inside(file.rootPath, canonicalPath)) return null;
  const handle = await open(canonicalPath, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const before = await handle.stat();
    if (!before.isFile()) return null;
    const id = sourceId(file.parserName, canonicalPath);
    const expected = database.cursor(canonicalPath);
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
      const committed = database.ingest({
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
