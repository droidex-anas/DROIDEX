import { createHash } from 'node:crypto';
import {
  CLAUDE_USAGE_PARSER_VERSION,
  CODEX_USAGE_PARSER_VERSION,
  type ClaudeUsageParserState,
  type CodexUsageParserState,
  type UsageEvent,
  type UsageParseResult,
  type UsageParserName,
  type UsageParserState,
  type UsageReducerSession,
  type UsageSourcePosition,
  type UsageTokenCounts,
} from './types.js';

export * from './types.js';
type JsonObject = Record<string, unknown>;
const MAX_TEXT_LENGTH = 4_096;
const MAX_ID_LENGTH = 512;
const MAX_TOKEN_COUNT = 1_000_000_000_000_000;
const MAX_MICROUSD = 9_000_000_000_000_000;
const MAX_TIMESTAMP = 8_640_000_000_000_000;
const MAX_SESSIONS_PER_SOURCE = 64;
const COUNT_KEYS = [
  'inputTokens',
  'outputTokens',
  'cacheWriteTokens',
  'cacheReadTokens',
  'reasoningTokens',
] as const satisfies readonly (keyof UsageTokenCounts)[];

const EMPTY_COUNTS: UsageTokenCounts = {
  inputTokens: null,
  outputTokens: null,
  cacheWriteTokens: null,
  cacheReadTokens: null,
  reasoningTokens: null,
};

export function parseClaudeUsageRecord(
  value: unknown,
  state: ClaudeUsageParserState,
  position: UsageSourcePosition,
): UsageParseResult<ClaudeUsageParserState> {
  requireState(state, 'claude-code', CLAUDE_USAGE_PARSER_VERSION);
  const record = object(value);
  if (record?.type !== 'assistant' || isReplay(record)) return { events: [], state };
  const message = object(record.message);
  const usage = object(message?.usage);
  const tsMs = timestamp(record.timestamp ?? message?.timestamp);
  if (!message || !usage || tsMs === null || message.model === '<synthetic>')
    return { events: [], state };

  const rawInput = count(usage.input_tokens ?? usage.inputTokens);
  const cacheReadTokens = count(usage.cache_read_input_tokens ?? usage.cacheReadInputTokens ?? 0);
  const cacheCreation = object(usage.cache_creation);
  const cacheWrite1hTokens = count(cacheCreation?.ephemeral_1h_input_tokens ?? 0);
  const cacheWriteTokens = count(
    usage.cache_creation_input_tokens ??
      usage.cacheCreationInputTokens ??
      (cacheCreation
        ? completeSum(count(cacheCreation.ephemeral_5m_input_tokens ?? 0), cacheWrite1hTokens)
        : 0),
  );
  const outputDetails = object(usage.output_tokens_details ?? usage.outputTokensDetails);
  const counts: UsageTokenCounts = {
    inputTokens: completeSum(rawInput, cacheReadTokens, cacheWriteTokens),
    outputTokens: count(usage.output_tokens ?? usage.outputTokens),
    cacheWriteTokens,
    cacheReadTokens,
    reasoningTokens: count(
      outputDetails?.thinking_tokens ??
        outputDetails?.thinkingTokens ??
        usage.reasoning_output_tokens ??
        usage.reasoningTokens,
    ),
  };
  const providerCostMicrousd = costMicrousd(record, message, usage);
  if (!hasUsage(counts, providerCostMicrousd)) return { events: [], state };

  const messageId = text(message.id, MAX_ID_LENGTH);
  const requestId = text(record.requestId ?? record.request_id, MAX_ID_LENGTH);
  const model = text(message.model, 160);
  const signature =
    messageId || requestId
      ? hashParts('message-request', messageId ?? '', requestId ?? '')
      : fallbackUsageSignature({
          harnessId: 'claude-code',
          sessionId: text(record.sessionId ?? record.session_id, MAX_ID_LENGTH),
          project: text(record.cwd ?? record.project, MAX_TEXT_LENGTH),
          sessionStartedAtMs: timestamp(record.sessionStartedAt ?? record.session_started_at),
          tsMs,
          model,
          counts,
          cost: providerCostMicrousd,
        });
  const snapshotSignature = hashParts(
    signature,
    JSON.stringify(counts),
    String(cacheWrite1hTokens),
  );
  if (snapshotSignature === state.lastSignature) return { events: [], state };

  const event = usageEvent({
    dedupeKey: `claude-code:${signature}`,
    harnessId: 'claude-code',
    harnessDisplayName: 'Claude Code',
    sourceId: position.sourceId,
    sessionId: text(record.sessionId ?? record.session_id, MAX_ID_LENGTH),
    project: text(record.cwd ?? record.project, MAX_TEXT_LENGTH),
    sessionStartedAtMs: timestamp(record.sessionStartedAt ?? record.session_started_at),
    tsMs,
    model,
    serviceTier:
      usage.speed === 'fast'
        ? 'fast'
        : text(usage.service_tier ?? usage.serviceTier, MAX_ID_LENGTH),
    counts,
    providerCostMicrousd,
    ...(cacheWrite1hTokens !== 0 ? { cacheWrite1hTokens } : {}),
  });
  return { events: [event], state: { ...state, lastSignature: snapshotSignature } };
}

export function parseCodexUsageRecord(
  value: unknown,
  state: CodexUsageParserState,
  position: UsageSourcePosition,
): UsageParseResult<CodexUsageParserState> {
  requireState(state, 'codex', CODEX_USAGE_PARSER_VERSION);
  const record = object(value);
  if (!record || isReplay(record)) return { events: [], state };
  const payload = object(record.payload) ?? record;
  if (isReplay(payload)) return { events: [], state };

  const recordType = text(record.type, 64);
  if (recordType === 'session_meta') {
    if (state.sessionMetaSeen) return { events: [], state };
    const sessionKey = text(
      payload.id ?? payload.thread_id ?? payload.threadId ?? payload.session_id,
      MAX_ID_LENGTH,
    );
    if (!sessionKey) return { events: [], state };
    return {
      events: [],
      state: setSession(
        {
          ...state,
          sessionMetaSeen: true,
          // Explicit fork headers can precede the replay burst; subagents write copies immediately.
          forkCopyWindowMs: typeof payload.forked_from_id === 'string' ? 1_000 : 100,
          forkCopyAnchorMs: isForkedSession(payload)
            ? timestamp(record.timestamp ?? payload.timestamp)
            : null,
        },
        sessionKey,
        {
          sessionId: sessionKey,
          project: text(payload.cwd ?? payload.project, MAX_TEXT_LENGTH),
          sessionStartedAtMs: timestamp(payload.timestamp ?? record.timestamp),
          model: text(payload.model, 160),
          serviceTier: text(payload.service_tier ?? payload.serviceTier, MAX_ID_LENGTH),
        },
      ),
    };
  }

  const sessionKey = sessionKeyFor(payload, state.activeSessionKey, position.sourceId);
  if (recordType === 'turn_context') {
    return {
      events: [],
      state: setSession(state, sessionKey, {
        sessionId: text(payload.session_id ?? payload.sessionId, MAX_ID_LENGTH),
        project: text(payload.cwd ?? payload.project, MAX_TEXT_LENGTH),
        sessionStartedAtMs: null,
        model: text(payload.model, 160),
        serviceTier: text(payload.service_tier ?? payload.serviceTier, MAX_ID_LENGTH),
      }),
    };
  }

  if (recordType === 'event_msg' && payload.type === 'thread_settings_applied') {
    const settings = object(payload.thread_settings);
    if (!settings || !Object.hasOwn(settings, 'service_tier')) return { events: [], state };
    return {
      events: [],
      state: setSession(state, sessionKey, {
        serviceTier: text(settings.service_tier, MAX_ID_LENGTH) ?? 'default',
      }),
    };
  }

  const isUsageRecord = recordType === 'token_usage_record';
  if (!isUsageRecord && (recordType !== 'event_msg' || payload.type !== 'token_count')) {
    return { events: [], state };
  }
  const info = isUsageRecord ? payload : (object(payload.info) ?? payload);
  if (isReplay(info)) return { events: [], state };
  const usage = isUsageRecord
    ? object(payload.usage)
    : object(info.last_token_usage ?? info.lastTokenUsage);
  const totalObject = isUsageRecord
    ? (object(payload.thread_token_usage ?? payload.threadTokenUsage) ??
      object(payload.turn_token_usage ?? payload.turnTokenUsage))
    : object(info.total_token_usage ?? info.totalTokenUsage);
  if (!usage && !totalObject) return { events: [], state };

  const previous = state.sessions[sessionKey] ?? emptySession();
  const active = state.activeSessionKey ? state.sessions[state.activeSessionKey] : undefined;
  // Response records use process totals; notifications use persisted session totals.
  // Keep the notification baseline independent and match their shared per-call usage.
  const total = !isUsageRecord && totalObject ? codexCounts(totalObject) : null;
  const nextTotal = mergeKnownCounts(previous.total, total);
  const counts = codexUsageCounts(usage, total, previous.total);
  const metadata = metadataFrom(withMetadataFallback(previous, active), payload, info);
  const tsMs = timestamp(record.timestamp ?? payload.timestamp);
  const providerCostMicrousd = costMicrousd(record, payload, info, usage, totalObject);
  const signature = codexRecordSignature({
    record,
    payload,
    info,
    tsMs,
    model: metadata.model,
    counts: counts ?? total,
    cost: providerCostMicrousd,
    sessionId: metadata.sessionId,
    project: metadata.project,
    sessionStartedAtMs: metadata.sessionStartedAtMs,
  });
  const nextState = setSession(state, sessionKey, {
    ...metadata,
    total: nextTotal,
    lastSignature: signature,
  });
  const nextSession = nextState.sessions[sessionKey];
  if (!Object.hasOwn(nextState.sessions, sessionKey)) return { events: [], state };
  nextSession.pendingProviderUsage = isUsageRecord ? counts : null;
  if (!isUsageRecord && sameKnownCounts(counts, previous.pendingProviderUsage)) {
    return { events: [], state: nextState };
  }
  // Codex rewrites inherited history to the fork instant in one dense burst.
  // Like T3 Code, skip that burst but retain its cumulative baseline.
  if (state.forkCopyAnchorMs !== null && tsMs !== null) {
    const gapMs = tsMs - state.forkCopyAnchorMs;
    if (gapMs < state.forkCopyWindowMs) {
      return {
        events: [],
        state: { ...nextState, forkCopyAnchorMs: Math.max(state.forkCopyAnchorMs, tsMs) },
      };
    }
    nextState.forkCopyAnchorMs = null;
  }
  if (
    !counts ||
    tsMs === null ||
    signature === previous.lastSignature ||
    !hasUsage(counts, providerCostMicrousd)
  ) {
    return { events: [], state: nextState };
  }

  return {
    events: [
      usageEvent({
        dedupeKey: `codex:${signature}`,
        harnessId: 'codex',
        harnessDisplayName: 'Codex',
        sourceId: position.sourceId,
        sessionId: metadata.sessionId,
        project: metadata.project,
        sessionStartedAtMs: metadata.sessionStartedAtMs,
        tsMs,
        model: metadata.model,
        serviceTier: metadata.serviceTier,
        counts: { ...counts, cacheWriteTokens: counts.cacheWriteTokens ?? 0 },
        providerCostMicrousd,
      }),
    ],
    state: nextState,
  };
}

export function parseUsageRecord(
  parserName: UsageParserName,
  value: unknown,
  state: UsageParserState,
  position: UsageSourcePosition,
): UsageParseResult {
  if (parserName === 'claude-code' && state.parserName === 'claude-code')
    return parseClaudeUsageRecord(value, state, position);
  if (parserName === 'codex' && state.parserName === 'codex')
    return parseCodexUsageRecord(value, state, position);
  throw new Error('Usage parser state does not match the selected parser');
}

function object(value: unknown): JsonObject | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as JsonObject)
    : null;
}

function text(value: unknown, maxLength: number): string | null {
  return typeof value === 'string' && value.length > 0 && value.length <= maxLength ? value : null;
}

function count(value: unknown): number | null {
  return Number.isSafeInteger(value) && Number(value) >= 0 && Number(value) <= MAX_TOKEN_COUNT
    ? Number(value)
    : null;
}

function timestamp(value: unknown): number | null {
  if (typeof value === 'string' && value.length <= 64) {
    const parsed = Date.parse(value);
    return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : null;
  }
  if (!Number.isFinite(value) || Number(value) < 0) return null;
  const milliseconds = Number(value) < 10_000_000_000 ? Number(value) * 1_000 : Number(value);
  return Number.isSafeInteger(milliseconds) && milliseconds <= MAX_TIMESTAMP ? milliseconds : null;
}

function completeSum(...values: (number | null)[]): number | null {
  if (values.some((value) => value === null)) return null;
  const total = values.reduce<number>((sum, value) => sum + (value ?? 0), 0);
  return Number.isSafeInteger(total) && total <= MAX_TOKEN_COUNT ? total : null;
}

function codexCounts(value: JsonObject): UsageTokenCounts {
  return {
    inputTokens: count(value.input_tokens ?? value.inputTokens),
    outputTokens: count(value.output_tokens ?? value.outputTokens),
    cacheWriteTokens: count(
      value.cache_creation_input_tokens ??
        value.cacheCreationInputTokens ??
        value.cache_write_tokens ??
        value.cache_write_input_tokens,
    ),
    cacheReadTokens: count(
      value.cached_input_tokens ?? value.cachedInputTokens ?? value.cache_read_input_tokens,
    ),
    reasoningTokens: count(value.reasoning_output_tokens ?? value.reasoningOutputTokens),
  };
}

function codexUsageCounts(
  usage: JsonObject | null,
  total: UsageTokenCounts | null,
  previous: UsageTokenCounts | null,
): UsageTokenCounts | null {
  if (sameKnownCounts(total, previous)) return null;
  if (usage) return codexCounts(usage);
  return cumulativeDelta(total, previous);
}

function cumulativeDelta(
  current: UsageTokenCounts | null,
  previous: UsageTokenCounts | null,
): UsageTokenCounts | null {
  if (!current) return null;
  if (!previous) return current;
  const delta = { ...EMPTY_COUNTS };
  for (const key of COUNT_KEYS) {
    const next = current[key];
    const before = previous[key];
    if (next === null) delta[key] = null;
    else if (before === null) delta[key] = next;
    else delta[key] = Math.max(0, next - before);
  }
  return COUNT_KEYS.every((key) => delta[key] === null || delta[key] === 0) ? null : delta;
}

function mergeKnownCounts(
  previous: UsageTokenCounts | null,
  current: UsageTokenCounts | null,
): UsageTokenCounts | null {
  if (!current) return previous;
  const merged = { ...EMPTY_COUNTS };
  for (const key of COUNT_KEYS) merged[key] = current[key] ?? previous?.[key] ?? null;
  return merged;
}

function sameKnownCounts(
  current: UsageTokenCounts | null,
  previous: UsageTokenCounts | null,
): boolean {
  if (!current || !previous) return false;
  let compared = false;
  for (const key of COUNT_KEYS) {
    if (current[key] === null || previous[key] === null) continue;
    compared = true;
    if (current[key] !== previous[key]) return false;
  }
  return compared;
}

function emptySession(): UsageReducerSession {
  return {
    total: null,
    pendingProviderUsage: null,
    lastSignature: null,
    sessionId: null,
    project: null,
    sessionStartedAtMs: null,
    model: null,
    serviceTier: null,
  };
}

function withMetadataFallback(
  session: UsageReducerSession,
  fallback: UsageReducerSession | undefined,
): UsageReducerSession {
  if (!fallback) return session;
  return {
    ...session,
    sessionId: session.sessionId ?? fallback.sessionId,
    project: session.project ?? fallback.project,
    sessionStartedAtMs: session.sessionStartedAtMs ?? fallback.sessionStartedAtMs,
    model: session.model ?? fallback.model,
    serviceTier: session.serviceTier ?? fallback.serviceTier,
  };
}

function setSession(
  state: CodexUsageParserState,
  key: string,
  patch: Partial<UsageReducerSession>,
): CodexUsageParserState {
  const exists = Object.hasOwn(state.sessions, key);
  if (!exists && Object.keys(state.sessions).length >= MAX_SESSIONS_PER_SOURCE) return state;
  const previous = exists ? state.sessions[key] : emptySession();
  const merged = { ...previous };
  for (const [field, value] of Object.entries(patch)) {
    if (value !== null) Object.assign(merged, { [field]: value });
  }
  return { ...state, activeSessionKey: key, sessions: { ...state.sessions, [key]: merged } };
}

function metadataFrom(previous: UsageReducerSession, ...values: JsonObject[]): UsageReducerSession {
  const first = (keys: string[], limit: number): string | null => {
    for (const value of values) {
      for (const key of keys) {
        const found = text(value[key], limit);
        if (found) return found;
      }
    }
    return null;
  };
  return {
    ...previous,
    sessionId:
      first(['threadId', 'thread_id', 'sessionId', 'session_id'], MAX_ID_LENGTH) ??
      previous.sessionId,
    project: first(['cwd', 'project'], MAX_TEXT_LENGTH) ?? previous.project,
    model: first(['model', 'modelId', 'model_id'], 160) ?? previous.model,
    serviceTier: first(['serviceTier', 'service_tier'], MAX_ID_LENGTH) ?? previous.serviceTier,
  };
}

function sessionKeyFor(value: JsonObject, active: string | null, sourceId: string): string {
  return (
    text(value.threadId ?? value.thread_id ?? value.sessionId ?? value.session_id, MAX_ID_LENGTH) ??
    active ??
    `source:${hashParts(sourceId)}`
  );
}

function isReplay(value: JsonObject): boolean {
  return (
    value.replayed === true ||
    value.isReplay === true ||
    value.is_replay === true ||
    value.isFork === true ||
    value.is_fork === true
  );
}

function isForkedSession(payload: JsonObject): boolean {
  const spawn = object(object(object(payload.source)?.subagent)?.thread_spawn);
  return typeof payload.forked_from_id === 'string' || typeof spawn?.parent_thread_id === 'string';
}

interface CodexSignatureInput {
  record: JsonObject;
  payload: JsonObject;
  info: JsonObject;
  tsMs: number | null;
  model: string | null;
  counts: UsageTokenCounts | null;
  cost: number | null;
  sessionId: string | null;
  project: string | null;
  sessionStartedAtMs: number | null;
}

function codexRecordSignature({
  record,
  payload,
  info,
  tsMs,
  model,
  counts,
  cost,
  sessionId,
  project,
  sessionStartedAtMs,
}: CodexSignatureInput): string {
  const identities = [
    ['response', payload.response_id ?? payload.responseId ?? info.response_id ?? info.responseId],
    ['request', payload.request_id ?? payload.requestId ?? info.request_id ?? info.requestId],
    ['event', payload.event_id ?? payload.eventId ?? info.event_id ?? info.eventId],
    ['response', record.response_id ?? record.responseId],
    ['request', record.request_id ?? record.requestId],
    ['event', record.event_id ?? record.eventId],
  ] as const;
  for (const [kind, value] of identities) {
    const id = text(value, MAX_ID_LENGTH);
    if (id) return hashParts(kind, id);
  }
  return fallbackUsageSignature({
    harnessId: 'codex',
    sessionId,
    project,
    sessionStartedAtMs,
    tsMs,
    model,
    counts,
    cost,
  });
}

interface FallbackSignatureInput {
  harnessId: string;
  sessionId: string | null;
  project: string | null;
  sessionStartedAtMs: number | null;
  tsMs: number | null;
  model: string | null;
  counts: UsageTokenCounts | null;
  cost: number | null;
}

function fallbackUsageSignature({
  harnessId,
  sessionId,
  project,
  sessionStartedAtMs,
  tsMs,
  model,
  counts,
  cost,
}: FallbackSignatureInput): string {
  return hashParts(
    'usage-metadata-v2',
    harnessId,
    sessionId ?? '',
    project ?? '',
    String(sessionStartedAtMs),
    String(tsMs),
    model ?? '',
    ...COUNT_KEYS.map((key) => String(counts?.[key] ?? '')),
    String(cost),
  );
}

function hashParts(...parts: string[]): string {
  const hash = createHash('sha256');
  for (const part of parts) hash.update(part).update('\0');
  return hash.digest('hex');
}

function costMicrousd(...values: (JsonObject | null)[]): number | null {
  for (const value of values) {
    if (!value) continue;
    const direct =
      value.providerCostMicrousd ?? value.provider_cost_microusd ?? value.cost_microusd;
    if (Number.isSafeInteger(direct) && Number(direct) >= 0 && Number(direct) <= MAX_MICROUSD)
      return Number(direct);
    const dollars = value.costUSD ?? value.cost_usd;
    if (typeof dollars !== 'number' || !Number.isFinite(dollars) || dollars < 0) continue;
    const microusd = Math.round(dollars * 1_000_000);
    if (Number.isSafeInteger(microusd) && microusd <= MAX_MICROUSD) return microusd;
  }
  return null;
}

function hasUsage(counts: UsageTokenCounts, cost: number | null): boolean {
  return cost !== null || Object.values(counts).some((value) => value !== null);
}

type UsageEventInput = Omit<
  UsageEvent,
  keyof UsageTokenCounts | 'estimatedCostMicrousd' | 'pricingVersion'
> & {
  counts: UsageTokenCounts;
};

function usageEvent({ counts, ...event }: UsageEventInput): UsageEvent {
  return {
    ...event,
    ...counts,
    estimatedCostMicrousd: null,
    pricingVersion: null,
  };
}

function requireState(state: UsageParserState, name: UsageParserName, version: number): void {
  if (state.parserName !== name || state.parserVersion !== version)
    throw new Error('Usage parser state is incompatible with this parser version');
}
