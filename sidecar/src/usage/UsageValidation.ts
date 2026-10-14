import { resolve } from 'node:path';

import type {
  OpaqueUsageCursor,
  OpaqueUsageCursorAdvance,
  OpaqueUsageIngestBatch,
} from './UsageSourceContract.js';
import { CURSOR_GUARD_BYTES } from './UsageSchema.js';
import type { UsageEvent, UsageIngestCursor, UsageParserName } from './types.js';
import { restoreUsageParserState } from './types.js';

const MAX_BATCH_EVENTS = 10_000;
const MAX_TEXT_LENGTH = 1_024;
const MAX_PARSER_STATE_LENGTH = 64 * 1_024;

export type UsageCursorAdvance = Omit<UsageIngestCursor, 'revision'>;

export interface UsageIngestBatch {
  expectedCursor: UsageIngestCursor | null;
  nextCursor: UsageCursorAdvance;
  reset: boolean;
  events: readonly UsageEvent[];
}

export function validateUsageBatch(batch: UsageIngestBatch): void {
  if (typeof batch.reset !== 'boolean') {
    throw new Error('Usage ingest batch is invalid.');
  }
  validateCursor(batch.nextCursor, false);
  if (batch.expectedCursor) validateCursor(batch.expectedCursor, true);
  validateEvents(batch.events, batch.nextCursor.sourceId);
}

export function validateOpaqueUsageBatch(batch: OpaqueUsageIngestBatch): void {
  if (typeof batch.reset !== 'boolean') {
    throw new Error('Usage source ingest batch is invalid.');
  }
  validateOpaqueCursor(batch.nextCursor, false);
  if (batch.expectedCursor) validateOpaqueCursor(batch.expectedCursor, true);
  validateEvents(batch.events, batch.nextCursor.sourceId);
}

export function validateSourcePath(sourcePath: string): void {
  requiredText(sourcePath, 'source path', 16 * MAX_TEXT_LENGTH);
  if (resolve(sourcePath) !== sourcePath) {
    throw new Error('Usage source path must be absolute and normalized.');
  }
}

export function validateOpaqueSourceKey(sourcePath: string, adapterName: string): void {
  validateSourcePath(sourcePath);
  requiredText(adapterName, 'adapter name');
}

export function assertExpectedCursor(
  current: UsageIngestCursor | null,
  expected: UsageIngestCursor | null,
): void {
  if (!current || !expected) {
    if (current !== expected) throw new Error('Usage ingest cursor is stale.');
    return;
  }
  if (cursorSignature(current) !== cursorSignature(expected)) {
    throw new Error('Usage ingest cursor is stale.');
  }
}

export function assertCursorAdvance(
  current: UsageIngestCursor | null,
  next: UsageCursorAdvance,
  reset: boolean,
): void {
  if (!current) {
    if (reset) throw new Error('A new usage source cannot be reset.');
    return;
  }
  if (
    current.sourcePath !== next.sourcePath ||
    current.sourceId !== next.sourceId ||
    current.parserName !== next.parserName
  ) {
    throw new Error('Usage cursor identity cannot change.');
  }
  const changedFile = current.fileIdentity !== next.fileIdentity;
  const truncated = next.fileSize < current.byteOffset;
  const changedParserVersion = current.parserVersion !== next.parserVersion;
  if (!reset) {
    if (changedFile || truncated || changedParserVersion) {
      throw new Error('Usage source rotation requires an explicit reset.');
    }
    if (next.byteOffset < current.byteOffset) {
      throw new Error('Usage cursor cannot move backwards.');
    }
  }
}

export function assertExpectedOpaqueCursor(
  current: OpaqueUsageCursor | null,
  expected: OpaqueUsageCursor | null,
): void {
  if (!current || !expected) {
    if (current !== expected) throw new Error('Usage source cursor is stale.');
    return;
  }
  if (opaqueCursorSignature(current) !== opaqueCursorSignature(expected)) {
    throw new Error('Usage source cursor is stale.');
  }
}

export function assertOpaqueCursorAdvance(
  current: OpaqueUsageCursor | null,
  next: OpaqueUsageCursorAdvance,
  reset: boolean,
): void {
  if (!current) {
    if (reset) throw new Error('A new usage source cannot be reset.');
    return;
  }
  if (
    current.sourcePath !== next.sourcePath ||
    current.sourceId !== next.sourceId ||
    current.adapterName !== next.adapterName
  ) {
    throw new Error('Usage source cursor identity cannot change.');
  }
  if (current.adapterVersion !== next.adapterVersion && !reset) {
    throw new Error('Usage source adapter changes require an explicit reset.');
  }
}

export function isUsageParserName(value: string): value is UsageParserName {
  return value === 'claude-code' || value === 'codex';
}

function validateCursor(cursor: UsageCursorAdvance | UsageIngestCursor, revision: boolean): void {
  validateSourcePath(cursor.sourcePath);
  requiredText(cursor.sourceId, 'source id');
  requiredText(cursor.fileIdentity, 'file identity');
  nonnegativeInteger(cursor.byteOffset, 'byte offset');
  nonnegativeInteger(cursor.fileSize, 'file size');
  nonnegativeInteger(cursor.mtimeMs, 'mtime');
  if (cursor.byteOffset > cursor.fileSize) throw new Error('Usage cursor exceeds the source size.');
  if (!(cursor.guard instanceof Uint8Array) || cursor.guard.byteLength !== CURSOR_GUARD_BYTES) {
    throw new Error('Usage cursor guard must be exactly 64 bytes.');
  }
  if (!isUsageParserName(cursor.parserName)) throw new Error('Usage cursor parser is invalid.');
  positiveInteger(cursor.parserVersion, 'parser version');
  requiredText(cursor.parserState, 'parser state', MAX_PARSER_STATE_LENGTH);
  if (typeof cursor.discardingOversized !== 'boolean') {
    throw new Error('Usage cursor discard state is invalid.');
  }
  if (!restoreUsageParserState(cursor.parserName, cursor.parserState)) {
    throw new Error('Usage cursor parser state does not match the current parser contract.');
  }
  if (revision) {
    if (!('revision' in cursor)) throw new Error('Usage cursor revision is missing.');
    positiveInteger(cursor.revision, 'cursor revision');
  }
}

export function validateOpaqueCursor(
  cursor: OpaqueUsageCursorAdvance | OpaqueUsageCursor,
  revision: boolean,
): void {
  validateOpaqueSourceKey(cursor.sourcePath, cursor.adapterName);
  requiredText(cursor.sourceId, 'source id');
  positiveInteger(cursor.adapterVersion, 'adapter version');
  validateJsonObject(cursor.state, 'adapter state');
  if (revision) {
    if (!('revision' in cursor)) throw new Error('Usage source cursor revision is missing.');
    positiveInteger(cursor.revision, 'source cursor revision');
  }
}

function validateEvents(events: readonly UsageEvent[], sourceId: string): void {
  if (events.length > MAX_BATCH_EVENTS) throw new Error('Usage ingest batch is too large.');
  for (const event of events) {
    validateEvent(event);
    if (event.sourceId !== sourceId) {
      throw new Error('Usage event source does not match its cursor.');
    }
  }
}

function validateEvent(event: UsageEvent): void {
  requiredText(event.dedupeKey, 'dedupe key');
  requiredText(event.harnessId, 'harness id');
  requiredText(event.harnessDisplayName, 'harness display name');
  requiredText(event.sourceId, 'source id');
  optionalText(event.sessionId, 'session id');
  optionalText(event.project, 'project', 16 * MAX_TEXT_LENGTH);
  optionalTimestamp(event.sessionStartedAtMs, 'session start');
  timestamp(event.tsMs, 'event timestamp');
  optionalText(event.model, 'model', 160);
  optionalText(event.serviceTier, 'service tier');
  optionalText(event.pricingVersion, 'pricing version');
  for (const value of [
    event.inputTokens,
    event.outputTokens,
    event.cacheWriteTokens,
    event.cacheReadTokens,
    event.reasoningTokens,
    event.providerCostMicrousd,
    event.estimatedCostMicrousd,
  ]) {
    optionalInteger(value, 'usage count');
  }
}

function requiredText(
  value: unknown,
  name: string,
  max = MAX_TEXT_LENGTH,
): asserts value is string {
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    value.length > max ||
    value.includes('\0')
  ) {
    throw new Error(`Usage ${name} is invalid.`);
  }
}

function optionalText(value: unknown, name: string, max = MAX_TEXT_LENGTH): void {
  if (value !== null) requiredText(value, name, max);
}

function nonnegativeInteger(value: unknown, name: string): asserts value is number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    throw new Error(`Usage ${name} is invalid.`);
  }
}

function positiveInteger(value: unknown, name: string): asserts value is number {
  nonnegativeInteger(value, name);
  if (value === 0) throw new Error(`Usage ${name} is invalid.`);
}

function optionalInteger(value: unknown, name: string): void {
  if (value !== null) nonnegativeInteger(value, name);
}

function timestamp(value: unknown, name: string): void {
  nonnegativeInteger(value, name);
  if (value > 8_640_000_000_000_000) throw new Error(`Usage ${name} is invalid.`);
}

function optionalTimestamp(value: unknown, name: string): void {
  if (value !== null) timestamp(value, name);
}

function validateJsonObject(value: unknown, name: string): void {
  if (typeof value !== 'string' || Buffer.byteLength(value) > MAX_PARSER_STATE_LENGTH) {
    throw new Error(`Usage ${name} is invalid.`);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new Error(`Usage ${name} is invalid.`);
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(`Usage ${name} is invalid.`);
  }
}

function cursorSignature(cursor: UsageIngestCursor): string {
  return JSON.stringify([
    cursor.sourcePath,
    cursor.sourceId,
    cursor.fileIdentity,
    cursor.byteOffset,
    cursor.fileSize,
    cursor.mtimeMs,
    Buffer.from(cursor.guard).toString('hex'),
    cursor.parserName,
    cursor.parserVersion,
    cursor.parserState,
    cursor.discardingOversized,
    cursor.revision,
  ]);
}

function opaqueCursorSignature(cursor: OpaqueUsageCursor): string {
  return JSON.stringify([
    cursor.sourcePath,
    cursor.sourceId,
    cursor.adapterName,
    cursor.adapterVersion,
    cursor.state,
    cursor.revision,
  ]);
}
