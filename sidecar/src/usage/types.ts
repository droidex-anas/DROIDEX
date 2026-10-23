export const CLAUDE_USAGE_PARSER_VERSION = 4;
export const CODEX_USAGE_PARSER_VERSION = 4;

export type UsageParserName = 'claude-code' | 'codex';

/**
 * Token categories preserve the provider's accounting instead of inventing
 * zeroes. Input includes cache reads and writes; both cache fields are subsets.
 * Output includes reasoning; reasoning is also a subset. Null means unknown.
 */
export interface UsageTokenCounts {
  inputTokens: number | null;
  outputTokens: number | null;
  cacheWriteTokens: number | null;
  cacheReadTokens: number | null;
  reasoningTokens: number | null;
}

export interface UsageEvent extends UsageTokenCounts {
  provider?: string | null;
  /** Subset of cache writes; absent breakdowns use the standard 5-minute estimate. */
  cacheWrite1hTokens?: number | null;
  dedupeKey: string;
  harnessId: string;
  harnessDisplayName: string;
  sourceId: string;
  sessionId: string | null;
  project: string | null;
  sessionStartedAtMs: number | null;
  tsMs: number;
  model: string | null;
  serviceTier: string | null;
  providerCostMicrousd: number | null;
  estimatedCostMicrousd: number | null;
  pricingVersion: string | null;
}

export interface UsageSourcePosition {
  sourceId: string;
  recordStartByte: number;
  /** First byte after the record's terminating newline. */
  recordEndByte: number;
}

export interface UsageReducerSession {
  total: UsageTokenCounts | null;
  pendingProviderUsage: UsageTokenCounts | null;
  lastSignature: string | null;
  sessionId: string | null;
  project: string | null;
  sessionStartedAtMs: number | null;
  model: string | null;
  serviceTier: string | null;
}

export interface ClaudeUsageParserState {
  parserName: 'claude-code';
  parserVersion: typeof CLAUDE_USAGE_PARSER_VERSION;
  lastSignature: string | null;
}

export interface CodexUsageParserState {
  parserName: 'codex';
  parserVersion: typeof CODEX_USAGE_PARSER_VERSION;
  activeSessionKey: string | null;
  sessionMetaSeen: boolean;
  forkCopyAnchorMs: number | null;
  forkCopyWindowMs: 100 | 1_000;
  sessions: Record<string, UsageReducerSession>;
}

export type UsageParserState = ClaudeUsageParserState | CodexUsageParserState;

export interface UsageParseResult<State extends UsageParserState = UsageParserState> {
  events: UsageEvent[];
  state: State;
}

/** Atomically persisted with events; discard mode means the offset is inside an oversized line. */
export interface UsageIngestCursor {
  sourcePath: string;
  sourceId: string;
  fileIdentity: string;
  byteOffset: number;
  fileSize: number;
  mtimeMs: number;
  guard: Uint8Array;
  parserName: UsageParserName;
  parserVersion: number;
  parserState: string;
  discardingOversized: boolean;
  revision: number;
}

const MAX_SERIALIZED_STATE_BYTES = 65_536;
const MAX_STATE_STRING_LENGTH = 4_096;
const MAX_STATE_SESSIONS = 64;
const MAX_STATE_COUNT = 1_000_000_000_000_000;

export function createClaudeUsageParserState(): ClaudeUsageParserState {
  return {
    parserName: 'claude-code',
    parserVersion: CLAUDE_USAGE_PARSER_VERSION,
    lastSignature: null,
  };
}

export function createCodexUsageParserState(): CodexUsageParserState {
  return {
    parserName: 'codex',
    parserVersion: CODEX_USAGE_PARSER_VERSION,
    activeSessionKey: null,
    sessionMetaSeen: false,
    forkCopyAnchorMs: null,
    forkCopyWindowMs: 1_000,
    sessions: {},
  };
}

export function createUsageParserState(parserName: UsageParserName): UsageParserState {
  if (parserName === 'claude-code') return createClaudeUsageParserState();
  return createCodexUsageParserState();
}

/** Restores only the current bounded state contract; older versions are invalidated. */
export function restoreUsageParserState(
  parserName: UsageParserName,
  serialized: string,
): UsageParserState | null {
  if (Buffer.byteLength(serialized) > MAX_SERIALIZED_STATE_BYTES) return null;
  let value: unknown;
  try {
    value = JSON.parse(serialized);
  } catch {
    return null;
  }
  const record = stateObject(value);
  if (record?.parserName !== parserName) return null;
  if (parserName === 'claude-code') {
    const signature = stateString(record.lastSignature, 64);
    return record.parserVersion === CLAUDE_USAGE_PARSER_VERSION && signature !== undefined
      ? { ...createClaudeUsageParserState(), lastSignature: signature }
      : null;
  }
  const activeSessionKey = stateString(record.activeSessionKey, MAX_STATE_STRING_LENGTH);
  const storedSessions = stateObject(record.sessions);
  const forkCopyAnchorMs = stateCount(record.forkCopyAnchorMs);
  if (
    record.parserVersion !== CODEX_USAGE_PARSER_VERSION ||
    activeSessionKey === undefined ||
    typeof record.sessionMetaSeen !== 'boolean' ||
    forkCopyAnchorMs === undefined ||
    (record.forkCopyWindowMs !== 100 && record.forkCopyWindowMs !== 1_000) ||
    !storedSessions ||
    Object.keys(storedSessions).length > MAX_STATE_SESSIONS
  ) {
    return null;
  }
  const sessions: Record<string, UsageReducerSession> = {};
  for (const [key, stored] of Object.entries(storedSessions)) {
    if (!key || key.length > MAX_STATE_STRING_LENGTH) return null;
    const session = restoredSession(stored);
    if (!session) return null;
    Object.defineProperty(sessions, key, {
      value: session,
      enumerable: true,
      configurable: true,
      writable: true,
    });
  }
  if (activeSessionKey !== null && !Object.hasOwn(sessions, activeSessionKey)) return null;
  return {
    ...createCodexUsageParserState(),
    activeSessionKey,
    sessions,
    sessionMetaSeen: record.sessionMetaSeen,
    forkCopyAnchorMs,
    forkCopyWindowMs: record.forkCopyWindowMs,
  };
}

function restoredSession(value: unknown): UsageReducerSession | null {
  const record = stateObject(value);
  if (!record) return null;
  const total = record.total === null ? null : restoredCounts(record.total);
  const pendingProviderUsage =
    record.pendingProviderUsage === null ? null : restoredCounts(record.pendingProviderUsage);
  const lastSignature = stateString(record.lastSignature, 64);
  const sessionId = stateString(record.sessionId, MAX_STATE_STRING_LENGTH);
  const project = stateString(record.project, MAX_STATE_STRING_LENGTH);
  const model = stateString(record.model, MAX_STATE_STRING_LENGTH);
  const serviceTier = stateString(record.serviceTier, MAX_STATE_STRING_LENGTH);
  const sessionStartedAtMs = stateCount(record.sessionStartedAtMs);
  if (
    (record.total !== null && !total) ||
    (record.pendingProviderUsage !== null && !pendingProviderUsage) ||
    lastSignature === undefined ||
    sessionId === undefined ||
    project === undefined ||
    sessionStartedAtMs === undefined ||
    model === undefined ||
    serviceTier === undefined
  ) {
    return null;
  }
  return {
    total,
    pendingProviderUsage,
    lastSignature,
    sessionId,
    project,
    sessionStartedAtMs,
    model,
    serviceTier,
  };
}

function restoredCounts(value: unknown): UsageTokenCounts | null {
  const record = stateObject(value);
  if (!record) return null;
  const counts = {
    inputTokens: stateCount(record.inputTokens),
    outputTokens: stateCount(record.outputTokens),
    cacheWriteTokens: stateCount(record.cacheWriteTokens),
    cacheReadTokens: stateCount(record.cacheReadTokens),
    reasoningTokens: stateCount(record.reasoningTokens),
  };
  return Object.values(counts).includes(undefined) ? null : (counts as UsageTokenCounts);
}

function stateObject(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function stateString(value: unknown, maxLength: number): string | null | undefined {
  if (value === null) return null;
  return typeof value === 'string' && value.length > 0 && value.length <= maxLength
    ? value
    : undefined;
}

function stateCount(value: unknown): number | null | undefined {
  if (value === null) return null;
  return Number.isSafeInteger(value) && Number(value) >= 0 && Number(value) <= MAX_STATE_COUNT
    ? Number(value)
    : undefined;
}
