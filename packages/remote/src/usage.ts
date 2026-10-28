export interface UsageBreakdown {
  id: string;
  name: string;
  sessions: number;
  turns: number | null;
  events: number;
  tokens: number;
  tokensComplete: boolean;
  costMicrousd: number | null;
  costComplete: boolean;
}

export interface UsageDay {
  date: string;
  events: number;
  tokens: number;
  tokensComplete: boolean;
  costMicrousd: number | null;
  costComplete: boolean;
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
  days: UsageDay[];
  harnesses: UsageBreakdown[];
  models: UsageBreakdown[];
  mostUsedHarness: string | null;
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

export type UsageTotalField = Exclude<
  keyof RemoteUsageSnapshot['totals'],
  'events' | 'tokensComplete'
>;

export function hasReportedTokens(usage: Pick<RemoteUsageSnapshot, 'totals'>): boolean {
  return usage.totals.inputTokens !== null || usage.totals.outputTokens !== null;
}

/** Copies only fields that may leave the laptop as an aggregate usage snapshot. */
export function remoteUsageSnapshot(value: unknown): RemoteUsageSnapshot {
  if (!record(value)) throw new Error('Invalid usage snapshot');
  const sync = usageSync(value.sync);
  const mostUsedHarness =
    value.mostUsedHarness === null ? null : boundedText(value.mostUsedHarness, 160);
  const lifetimeTokens = integer(value.lifetimeTokens);
  const peakDayTokens = integer(value.peakDayTokens);
  const sessions = integer(value.sessions);
  const currentStreak = integer(value.currentStreak);
  const longestStreak = integer(value.longestStreak);
  const trackingSince = integer(value.trackingSince);
  const days = activityDays(value.days);
  const harnesses = breakdowns(value.harnesses, 32);
  const models = breakdowns(value.models, 256);
  const totals = usageTotals(value.totals);
  const coverage = usageCoverage(value.coverage);
  const timeZone = boundedText(value.timeZone, 80);
  if (
    !sync ||
    (value.mostUsedHarness !== null && !mostUsedHarness) ||
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
  if (mostUsedHarness !== (harnesses[0]?.id ?? null)) {
    throw new Error('Invalid usage snapshot');
  }
  return {
    mostUsedHarness,
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

function activityDays(value: unknown): UsageDay[] | null {
  if (!Array.isArray(value) || value.length > 366) return null;
  const days: UsageDay[] = [];
  let previous = '';
  for (const day of value) {
    if (!record(day) || !calendarDay(day.date) || day.date <= previous) return null;
    const events = integer(day.events);
    const tokens = integer(day.tokens);
    const costMicrousd = nullableInteger(day.costMicrousd);
    if (
      events === null ||
      tokens === null ||
      costMicrousd === undefined ||
      typeof day.tokensComplete !== 'boolean' ||
      typeof day.costComplete !== 'boolean'
    )
      return null;
    days.push({
      date: day.date,
      events,
      tokens,
      costMicrousd,
      tokensComplete: day.tokensComplete,
      costComplete: day.costComplete,
    });
    previous = day.date;
  }
  return days;
}

function breakdowns(value: unknown, limit: number): UsageBreakdown[] | null {
  if (!Array.isArray(value) || value.length > limit) return null;
  const result: UsageBreakdown[] = [];
  for (const row of value) {
    if (!record(row)) return null;
    const id = boundedText(row.id, 160);
    const name = boundedText(row.name, 160);
    const sessions = integer(row.sessions);
    const turns = nullableInteger(row.turns);
    const events = integer(row.events);
    const tokens = integer(row.tokens);
    const costMicrousd = nullableInteger(row.costMicrousd);
    if (
      !id ||
      !name ||
      sessions === null ||
      turns === undefined ||
      events === null ||
      tokens === null ||
      costMicrousd === undefined ||
      typeof row.tokensComplete !== 'boolean' ||
      typeof row.costComplete !== 'boolean'
    )
      return null;
    result.push({
      id,
      name,
      sessions,
      turns,
      events,
      tokens,
      costMicrousd,
      tokensComplete: row.tokensComplete,
      costComplete: row.costComplete,
    });
  }
  return result;
}

function usageSync(value: unknown): RemoteUsageSync | null {
  if (!record(value) || !syncState(value.status) || !record(value.sources)) return null;
  const jsonl = value.sources.jsonl;
  const openCode = value.sources.openCode;
  const droid = value.sources.droid;
  if (!syncState(jsonl) || !syncState(openCode) || !syncState(droid)) return null;
  let derived: UsageSyncState = 'indexing';
  if ([jsonl, openCode, droid].includes('error')) derived = 'error';
  else if ([jsonl, openCode, droid].every((state) => state === 'ready')) derived = 'ready';
  if (value.status !== derived) return null;
  return { status: derived, sources: { jsonl, openCode, droid } };
}

function syncState(value: unknown): value is UsageSyncState {
  return value === 'indexing' || value === 'ready' || value === 'error';
}

function calendarDay(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
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
