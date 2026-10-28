import { formatRelativeTime } from '../../lib/time';
import { WINDOW_NAMES } from '../../lib/usageLimit';
import type { UsageExtra, UsageMeter } from '../../types/bridge';
import type { UsagePace } from './usagePace';

const MINUTE_MS = 60_000;

// "5-hour", "Weekly · Opus".
export function meterLabel(meter: UsageMeter): string {
  const name = windowName(meter);
  return meter.model ? `${name} · ${meter.model}` : name;
}

// The meter as a limit in a sentence: "5-hour", "weekly Opus".
export function limitName(meter: UsageMeter): string {
  return [windowName(meter).toLowerCase(), meter.model].filter(Boolean).join(' ');
}

// A window outside the named ones goes by its length.
function windowName({ window, durationMs }: UsageMeter): string {
  if (window) return WINDOW_NAMES[window];
  if (durationMs === undefined) return 'Usage';
  const hours = Math.round(durationMs / (60 * MINUTE_MS));
  return hours < 48 ? `${String(hours)}-hour` : `${String(Math.round(hours / 24))}-day`;
}

// "1h 40m", "3d 4h", "40m", never under a minute.
export function formatDuration(ms: number): string {
  const minutes = Math.max(1, Math.round(ms / MINUTE_MS));
  const days = Math.floor(minutes / 1440);
  const hours = Math.floor((minutes % 1440) / 60);
  const rest = minutes % 60;
  if (days > 0) return hours ? `${String(days)}d ${String(hours)}h` : `${String(days)}d`;
  if (hours > 0) return rest ? `${String(hours)}h ${String(rest)}m` : `${String(hours)}h`;
  return `${String(rest)}m`;
}

export function paceLabel(pace: UsagePace): string {
  if (pace.kind === 'reached') return 'Limit reached';
  if (pace.kind === 'lasts') return 'Lasts until reset';
  return `Runs out in ${formatDuration(pace.inMs)}`;
}

export function usedLabel(usedPercent: number): string {
  return `${String(Math.round(usedPercent))}% used`;
}

export function extraLabel(extra: UsageExtra): string | undefined {
  if (extra.kind === 'limit_resets') {
    if (extra.available === 0) return undefined;
    return `${String(extra.available)} limit ${extra.available === 1 ? 'reset' : 'resets'} left`;
  }
  if (extra.kind === 'extra_usage')
    return extra.usedPercent === undefined
      ? 'Extra usage on'
      : `Extra usage on · ${usedLabel(extra.usedPercent)} this month`;
  return `$${(extra.cents / 100).toFixed(2)} of extra usage left`;
}

// "Updated just now", "Updated 2m ago".
export function updatedLabel(updatedAt: number, now: number): string {
  const ago = formatRelativeTime(updatedAt, now);
  return ago === 'now' ? 'Updated just now' : `Updated ${ago} ago`;
}
