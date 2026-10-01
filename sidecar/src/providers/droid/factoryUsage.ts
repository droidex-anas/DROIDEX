// Factory's account limits, read with the API key DROIDEX was given: the same
// windows Droid's own /limits shows, for the standard pool and Droid Core. A
// Droid session never reports them, and DROIDEX never reads the CLI's login.
import type { UsageLimit, UsageWindow } from '../../protocol.js';
import { numberValue, objectValue } from '../../values.js';
import { UsageReadError } from '../accountUsage.js';
import { windowUsage } from '../usageLimit.js';
import type { ReportedMeter, UsageReading } from '../session.js';

const LIMITS_URL = 'https://api.factory.ai/api/billing/limits';
const HOUR_MS = 60 * 60_000;
const DEFAULT_RETRY_AFTER_MS = 5 * 60_000;
// Factory's name for the pool every model outside Droid Core draws on.
const STANDARD_POOL = 'Standard';

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

// What Factory's windows say about a refused Droid turn: the spent window that
// resets last, and the pool it belongs to only while the other pool still has
// room, which is when another model can still run.
export function factoryRefusalLimit(meters: readonly ReportedMeter[], now: number): UsageLimit {
  const spent = meters
    .filter((meter) => meter.usedPercent >= 100 && (meter.resetsAt ?? 0) > now)
    .sort((left, right) => (right.resetsAt ?? 0) - (left.resetsAt ?? 0));
  const last = spent.at(0);
  if (last?.resetsAt === undefined) return {};
  const limit: UsageLimit = {
    ...(last.window ? { window: last.window } : {}),
    resetsAt: last.resetsAt,
  };
  const otherPool = meters.filter((meter) => meter.model !== last.model);
  const otherHasRoom = otherPool.length > 0 && otherPool.every((meter) => !spent.includes(meter));
  return otherHasRoom ? { ...limit, model: last.model ?? STANDARD_POOL } : limit;
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
    return [
      {
        id: `${pool}_${key}`,
        window,
        ...(model ? { model } : {}),
        ...windowUsage(usedPercent, timestampMs(entry?.windowEnd)),
        durationMs,
      },
    ];
  });
}

// Read as Droid's own /limits reads it, with `new Date(windowEnd)`. A date at
// or before the epoch is malformed, not a window that has already reset.
function timestampMs(value: unknown): number | undefined {
  if (typeof value !== 'string' && typeof value !== 'number') return undefined;
  const ms = new Date(value).getTime();
  return Number.isNaN(ms) || ms <= 0 ? undefined : ms;
}

// Seconds, or an HTTP date.
function retryAfterMs(header: string | null): number {
  if (!header) return DEFAULT_RETRY_AFTER_MS;
  const seconds = Number(header);
  if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1000;
  const at = Date.parse(header);
  return Number.isNaN(at) ? DEFAULT_RETRY_AFTER_MS : Math.max(0, at - Date.now());
}
