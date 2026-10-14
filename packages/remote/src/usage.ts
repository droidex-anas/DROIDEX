export interface RemoteUsageRanking {
  name: string;
  sessions: number;
  events: number;
  tokens: number;
  complete: boolean;
}

export type UsageSyncState = 'indexing' | 'ready' | 'error';

export interface RemoteUsageSync {
  status: UsageSyncState;
  sources: {
    jsonl: UsageSyncState;
    openCode: UsageSyncState;
    droid: UsageSyncState;
  };
}

export interface RemoteUsageSnapshot {
  sync: RemoteUsageSync;
  lifetimeTokens: number;
  peakDayTokens: number;
  sessions: number;
  currentStreak: number;
  longestStreak: number;
  trackingSince: number;
  days: { date: string; tokens: number; events: number; complete: boolean }[];
  harnesses: RemoteUsageRanking[];
  models: RemoteUsageRanking[];
  totals: {
    events: number;
    inputTokens: number | null;
    outputTokens: number | null;
    cacheWriteTokens: number | null;
    cacheReadTokens: number | null;
    reasoningTokens: number | null;
    providerCostMicrousd: number | null;
    estimatedCostMicrousd: number | null;
    tokensComplete: boolean;
  };
  coverage: Record<string, { known: number; events: number }>;
  timeZone: string;
}

/** Copies only fields that may leave the laptop as an aggregate usage snapshot. */
export function remoteUsageSnapshot(value: unknown): RemoteUsageSnapshot {
  if (!record(value)) throw new Error('Invalid usage snapshot');
  const sync = usageSync(value.sync);
  const lifetimeTokens = integer(value.lifetimeTokens);
  const peakDayTokens = integer(value.peakDayTokens);
  const sessions = integer(value.sessions);
  const currentStreak = integer(value.currentStreak);
  const longestStreak = integer(value.longestStreak);
  const trackingSince = integer(value.trackingSince);
  const days = activityDays(value.days);
  const harnesses = rankings(value.harnesses);
  const models = rankings(value.models);
  const totals = usageTotals(value.totals);
  const coverage = usageCoverage(value.coverage);
  const timeZone = boundedText(value.timeZone, 80);
  if (
    !sync ||
    lifetimeTokens === null ||
    peakDayTokens === null ||
    sessions === null ||
    currentStreak === null ||
    longestStreak === null ||
    trackingSince === null ||
    !days ||
    !harnesses ||
    !models ||
    !totals ||
    !coverage ||
    !timeZone
  ) {
    throw new Error('Invalid usage snapshot');
  }
  return {
    sync,
    lifetimeTokens,
    peakDayTokens,
    sessions,
    currentStreak,
    longestStreak,
    trackingSince,
    days,
    harnesses,
    models,
    totals,
    coverage,
    timeZone,
  };
}

function usageSync(value: unknown): RemoteUsageSync | null {
  if (!record(value) || !syncState(value.status) || !record(value.sources)) return null;
  const jsonl = value.sources.jsonl;
  const openCode = value.sources.openCode;
  const droid = value.sources.droid;
  if (!syncState(jsonl) || !syncState(openCode) || !syncState(droid)) return null;
  const derived = [jsonl, openCode, droid].includes('error')
    ? 'error'
    : [jsonl, openCode, droid].every((state) => state === 'ready')
      ? 'ready'
      : 'indexing';
  if (value.status !== derived) return null;
  return { status: derived, sources: { jsonl, openCode, droid } };
}

function syncState(value: unknown): value is UsageSyncState {
  return value === 'indexing' || value === 'ready' || value === 'error';
}

function activityDays(value: unknown): RemoteUsageSnapshot['days'] | null {
  if (!Array.isArray(value) || value.length > 366) return null;
  const days: RemoteUsageSnapshot['days'] = [];
  let previous = '';
  for (const item of value) {
    if (!record(item) || !calendarDay(item.date) || item.date <= previous) {
      return null;
    }
    const tokens = integer(item.tokens);
    const events = integer(item.events);
    if (tokens === null || events === null || typeof item.complete !== 'boolean') return null;
    days.push({ date: item.date, tokens, events, complete: item.complete });
    previous = item.date;
  }
  return days;
}

function calendarDay(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function rankings(value: unknown): RemoteUsageRanking[] | null {
  if (!Array.isArray(value) || value.length > 5) return null;
  const rows: RemoteUsageRanking[] = [];
  for (const item of value) {
    if (!record(item)) return null;
    const name = boundedText(item.name, 160);
    const sessions = integer(item.sessions);
    const events = integer(item.events);
    const tokens = integer(item.tokens);
    if (
      !name ||
      sessions === null ||
      events === null ||
      tokens === null ||
      typeof item.complete !== 'boolean'
    ) {
      return null;
    }
    rows.push({ name, sessions, events, tokens, complete: item.complete });
  }
  return rows;
}

function usageTotals(value: unknown): RemoteUsageSnapshot['totals'] | null {
  if (!record(value) || typeof value.tokensComplete !== 'boolean') return null;
  const events = integer(value.events);
  const inputTokens = nullableInteger(value.inputTokens);
  const outputTokens = nullableInteger(value.outputTokens);
  const cacheWriteTokens = nullableInteger(value.cacheWriteTokens);
  const cacheReadTokens = nullableInteger(value.cacheReadTokens);
  const reasoningTokens = nullableInteger(value.reasoningTokens);
  const providerCostMicrousd = nullableInteger(value.providerCostMicrousd);
  const estimatedCostMicrousd = nullableInteger(value.estimatedCostMicrousd);
  if (
    events === null ||
    inputTokens === undefined ||
    outputTokens === undefined ||
    cacheWriteTokens === undefined ||
    cacheReadTokens === undefined ||
    reasoningTokens === undefined ||
    providerCostMicrousd === undefined ||
    estimatedCostMicrousd === undefined
  ) {
    return null;
  }
  return {
    events,
    inputTokens,
    outputTokens,
    cacheWriteTokens,
    cacheReadTokens,
    reasoningTokens,
    providerCostMicrousd,
    estimatedCostMicrousd,
    tokensComplete: value.tokensComplete,
  };
}

function usageCoverage(value: unknown): RemoteUsageSnapshot['coverage'] | null {
  if (!record(value) || Object.keys(value).length > 16) return null;
  const result: RemoteUsageSnapshot['coverage'] = {};
  for (const [name, raw] of Object.entries(value)) {
    if (!/^[a-z][A-Za-z]{0,39}$/.test(name) || !record(raw)) return null;
    const known = integer(raw.known);
    const events = integer(raw.events);
    if (known === null || events === null || known > events) return null;
    result[name] = { known, events };
  }
  return result;
}

function integer(value: unknown): number | null {
  return Number.isSafeInteger(value) && Number(value) >= 0 ? Number(value) : null;
}

function nullableInteger(value: unknown): number | null | undefined {
  return value === null ? null : (integer(value) ?? undefined);
}

function boundedText(value: unknown, limit: number): string | null {
  return typeof value === 'string' && value.length > 0 && value.length <= limit ? value : null;
}

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
