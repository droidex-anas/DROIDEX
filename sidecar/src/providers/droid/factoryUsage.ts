// Factory's account limits, read with the API key DROIDEX was given: the same
// windows Droid's own /limits shows, for the standard pool and Droid Core. A
// Droid session never reports them, and DROIDEX never reads the CLI's login.
import type { UsageWindow } from '../../protocol.js';
import { numberValue, objectValue } from '../../values.js';
import { UsageReadError } from '../accountUsage.js';
import type { ReportedMeter, UsageReading } from '../session.js';

const LIMITS_URL = 'https://api.factory.ai/api/billing/limits';
const HOUR_MS = 60 * 60_000;
const DEFAULT_RETRY_AFTER_MS = 5 * 60_000;

// Droid's three rolling windows, by the names Factory gives them.
const WINDOWS: [key: string, window: UsageWindow, durationMs: number][] = [
  ['fiveHour', 'five_hour', 5 * HOUR_MS],
  ['weekly', 'weekly', 7 * 24 * HOUR_MS],
  ['monthly', 'monthly', 30 * 24 * HOUR_MS],
];

export async function readFactoryUsage(
  apiKey: string | undefined,
  signal: AbortSignal,
): Promise<UsageReading> {
  if (!apiKey) return { meters: [], unavailable: 'no_api_key' };
  const response = await fetch(LIMITS_URL, {
    headers: { Authorization: `Bearer ${apiKey}`, Accept: 'application/json' },
    signal,
  });
  if (response.status === 429 || response.status === 503)
    throw new UsageReadError(
      `Factory asked to wait (HTTP ${String(response.status)}).`,
      retryAfterMs(response.headers.get('retry-after')),
    );
  if (!response.ok) throw new Error(`Factory answered HTTP ${String(response.status)}.`);
  return factoryReading(await response.json());
}

// An account on Factory's older billing has no windows to report; any other
// answer without them is not one this build can read.
function factoryReading(value: unknown): UsageReading {
  const body = objectValue(value);
  if (body?.usesTokenRateLimitsBilling === false)
    return { meters: [], unavailable: 'no_plan_limits' };
  const limits = objectValue(body?.limits);
  const meters = [
    ...poolMeters('standard', limits?.standard, undefined),
    ...poolMeters('core', limits?.core, 'Droid Core'),
  ];
  if (meters.length === 0) throw new Error('Factory answered without any usage window.');
  const cents = Math.round(numberValue(body?.extraUsageBalanceCents) ?? 0);
  return { meters, ...(cents > 0 ? { extra: { kind: 'extra_balance', cents } } : {}) };
}

function poolMeters(pool: string, value: unknown, model: string | undefined): ReportedMeter[] {
  const windows = objectValue(value);
  if (!windows) return [];
  return WINDOWS.flatMap(([key, window, durationMs]) => {
    const entry = objectValue(windows[key]);
    const usedPercent = numberValue(entry?.usedPercent);
    if (usedPercent === undefined) return [];
    const resetsAt = timestampMs(entry?.windowEnd);
    // A rolling window whose end has passed has emptied; Factory can still
    // send the figure it had.
    const ended = resetsAt !== undefined && resetsAt <= Date.now();
    return [
      {
        id: `${pool}_${key}`,
        window,
        ...(model ? { model } : {}),
        usedPercent: ended ? 0 : Math.min(100, Math.max(0, usedPercent)),
        ...(resetsAt === undefined || ended ? {} : { resetsAt }),
        durationMs,
      },
    ];
  });
}

// Read as Droid's own /limits reads it, with `new Date(windowEnd)`.
function timestampMs(value: unknown): number | undefined {
  if (typeof value !== 'string' && typeof value !== 'number') return undefined;
  const ms = new Date(value).getTime();
  return Number.isNaN(ms) ? undefined : ms;
}

// Seconds, or an HTTP date.
function retryAfterMs(header: string | null): number {
  if (!header) return DEFAULT_RETRY_AFTER_MS;
  const seconds = Number(header);
  if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1000;
  const at = Date.parse(header);
  return Number.isNaN(at) ? DEFAULT_RETRY_AFTER_MS : Math.max(0, at - Date.now());
}
