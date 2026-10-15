import type { DatabaseSync } from 'node:sqlite';

import { SUM_COLUMNS } from './UsageSchema.js';

const DAY_MS = 24 * 60 * 60 * 1_000;
const COVERAGE_NAMES = {
  input_tokens: 'inputTokens',
  output_tokens: 'outputTokens',
  cache_write_tokens: 'cacheWriteTokens',
  cache_read_tokens: 'cacheReadTokens',
  reasoning_tokens: 'reasoningTokens',
  provider_cost_microusd: 'providerCostMicrousd',
  estimated_cost_microusd: 'estimatedCostMicrousd',
} as const;

interface RankedUsage {
  name: string;
  sessions: number;
  events: number;
  tokens: number;
  complete: boolean;
}

export interface UsageSnapshot {
  lifetimeTokens: number;
  peakDayTokens: number;
  sessions: number;
  currentStreak: number;
  longestStreak: number;
  trackingSince: number;
  days: { date: string; tokens: number; events: number; complete: boolean }[];
  harnesses: RankedUsage[];
  models: RankedUsage[];
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

export function createUsageSnapshot(
  db: DatabaseSync,
  now: number,
  timeZone: string,
): UsageSnapshot {
  const totalsRow = db.prepare('SELECT * FROM usage_totals').get();
  if (!totalsRow) throw new Error('Usage totals are unavailable.');
  const events = rowNumber(totalsRow, 'events');
  const inputTokens = nullableNumber(totalsRow, 'input_tokens');
  const outputTokens = nullableNumber(totalsRow, 'output_tokens');
  const totals = {
    events,
    inputTokens,
    outputTokens,
    cacheWriteTokens: nullableNumber(totalsRow, 'cache_write_tokens'),
    cacheReadTokens: nullableNumber(totalsRow, 'cache_read_tokens'),
    reasoningTokens: nullableNumber(totalsRow, 'reasoning_tokens'),
    providerCostMicrousd: nullableNumber(totalsRow, 'provider_cost_microusd'),
    estimatedCostMicrousd: nullableNumber(totalsRow, 'estimated_cost_microusd'),
    tokensComplete:
      rowNumber(totalsRow, 'input_tokens_known') === events &&
      rowNumber(totalsRow, 'output_tokens_known') === events,
  };
  const days = dailyRows(db);
  const streaks = calculateStreaks(
    days.map((day) => day.date),
    dayKey(now, timeZone),
  );
  const trackingSince =
    nullableNumber(db.prepare('SELECT first_event_at AS value FROM rollup_state').get(), 'value') ??
    now;
  return {
    lifetimeTokens: (inputTokens ?? 0) + (outputTokens ?? 0),
    peakDayTokens: days.reduce((peak, day) => Math.max(peak, day.tokens), 0),
    sessions: scalar(db, 'SELECT COUNT(*) AS value FROM droidex_session'),
    currentStreak: streaks.current,
    longestStreak: streaks.longest,
    trackingSince,
    days: days.slice(-366),
    harnesses: rankings(db, 'harness'),
    models: rankings(db, 'model'),
    totals,
    coverage: Object.fromEntries(
      SUM_COLUMNS.map((column) => [
        COVERAGE_NAMES[column],
        { known: rowNumber(totalsRow, `${column}_known`), events },
      ]),
    ),
    timeZone,
  };
}

export function canonicalTimeZone(timeZone: string): string {
  try {
    return new Intl.DateTimeFormat('en-US', { timeZone }).resolvedOptions().timeZone;
  } catch {
    throw new Error(`Usage timezone ${timeZone} is not a valid IANA timezone.`);
  }
}

export function systemTimeZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone;
}

let cachedFormatter: { timeZone: string; formatter: Intl.DateTimeFormat } | undefined;

export function dayKey(timestamp: number, timeZone: string): string {
  if (!Number.isSafeInteger(timestamp) || timestamp < 0 || timestamp > 8_640_000_000_000_000) {
    throw new Error('Usage timestamp is invalid.');
  }
  if (cachedFormatter?.timeZone !== timeZone) {
    cachedFormatter = {
      timeZone,
      formatter: new Intl.DateTimeFormat('en-US', {
        timeZone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      }),
    };
  }
  let year = '';
  let month = '';
  let day = '';
  for (const part of cachedFormatter.formatter.formatToParts(timestamp)) {
    if (part.type === 'year') year = part.value;
    if (part.type === 'month') month = part.value;
    if (part.type === 'day') day = part.value;
  }
  if (!year || !month || !day) throw new Error('Usage day could not be resolved.');
  return `${year}-${month}-${day}`;
}

function dailyRows(
  db: DatabaseSync,
): { date: string; tokens: number; events: number; complete: boolean }[] {
  return db
    .prepare(
      `
      SELECT day, SUM(COALESCE(input_tokens, 0) + COALESCE(output_tokens, 0)) AS tokens,
        SUM(event_count) AS events, SUM(input_tokens_known_events) AS input_known,
        SUM(output_tokens_known_events) AS output_known
      FROM usage_daily GROUP BY day ORDER BY day
    `,
    )
    .all()
    .map((row) => {
      const events = rowNumber(row, 'events');
      return {
        date: rowString(row, 'day'),
        tokens: rowNumber(row, 'tokens'),
        events,
        complete:
          rowNumber(row, 'input_known') === events && rowNumber(row, 'output_known') === events,
      };
    });
}

function rankings(db: DatabaseSync, kind: 'harness' | 'model'): RankedUsage[] {
  const sql = kind === 'harness' ? harnessRankingsSql() : modelRankingsSql();
  return db
    .prepare(sql)
    .all()
    .map((row) => {
      const events = rowNumber(row, 'events');
      return {
        name: rowString(row, 'name'),
        sessions: rowNumber(row, 'sessions'),
        events,
        tokens: rowNumber(row, 'tokens'),
        complete:
          rowNumber(row, 'input_known') === events && rowNumber(row, 'output_known') === events,
      };
    });
}

function harnessRankingsSql(): string {
  return `
    WITH usage AS (
      SELECT harness_id, SUM(event_count) AS events,
        SUM(COALESCE(input_tokens, 0) + COALESCE(output_tokens, 0)) AS tokens,
        SUM(input_tokens_known_events) AS input_known,
        SUM(output_tokens_known_events) AS output_known
      FROM usage_daily GROUP BY harness_id
    ), sessions AS (
      SELECT harness_id, COUNT(DISTINCT session_id) AS sessions
      FROM usage_session_model GROUP BY harness_id
    )
    SELECT h.display_name AS name, usage.events, COALESCE(sessions.sessions, 0) AS sessions,
      usage.tokens, usage.input_known, usage.output_known
    FROM usage JOIN harness h ON h.id = usage.harness_id
    LEFT JOIN sessions ON sessions.harness_id = usage.harness_id
    ORDER BY sessions DESC, events DESC, name LIMIT 5
  `;
}

function modelRankingsSql(): string {
  return `
    WITH usage AS (
      SELECT model, SUM(event_count) AS events,
        SUM(COALESCE(input_tokens, 0) + COALESCE(output_tokens, 0)) AS tokens,
        SUM(input_tokens_known_events) AS input_known,
        SUM(output_tokens_known_events) AS output_known
      FROM usage_daily WHERE model IS NOT NULL GROUP BY model
    ), sessions AS (
      SELECT model, COUNT(*) AS sessions
      FROM usage_session_model WHERE model IS NOT NULL GROUP BY model
    )
    SELECT usage.model AS name, usage.events, COALESCE(sessions.sessions, 0) AS sessions,
      usage.tokens, usage.input_known, usage.output_known
    FROM usage LEFT JOIN sessions ON sessions.model = usage.model
    ORDER BY sessions DESC, events DESC, name LIMIT 5
  `;
}

function calculateStreaks(days: string[], today: string): { current: number; longest: number } {
  let run = 0;
  let longest = 0;
  let previous = '';
  for (const day of days) {
    run = previous && previousDay(day) === previous ? run + 1 : 1;
    longest = Math.max(longest, run);
    previous = day;
  }
  const last = days.at(-1);
  const current = last === today || (last !== undefined && last === previousDay(today)) ? run : 0;
  return { current, longest };
}

function previousDay(day: string): string {
  return new Date(Date.parse(`${day}T00:00:00Z`) - DAY_MS).toISOString().slice(0, 10);
}

function scalar(db: DatabaseSync, sql: string): number {
  return rowNumber(db.prepare(sql).get(), 'value');
}

function rowNumber(row: Record<string, unknown> | undefined, key: string): number {
  const value = row?.[key];
  if (typeof value !== 'number' || !Number.isSafeInteger(value)) {
    throw new Error(`Usage aggregate ${key} is corrupt.`);
  }
  return value;
}

function nullableNumber(row: Record<string, unknown> | undefined, key: string): number | null {
  const value = row?.[key];
  if (value === null) return null;
  return rowNumber(row, key);
}

function rowString(row: Record<string, unknown>, key: string): string {
  const value = row[key];
  if (typeof value !== 'string') throw new Error(`Usage aggregate ${key} is corrupt.`);
  return value;
}
