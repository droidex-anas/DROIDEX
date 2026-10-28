import type { UsageLimit, UsageWindow } from '../types/bridge';

const DAY_MS = 24 * 60 * 60 * 1000;

const timeFormat = new Intl.DateTimeFormat(undefined, {
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});
const weekdayFormat = new Intl.DateTimeFormat(undefined, { weekday: 'long' });
const monthDayFormat = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' });
const fullDateFormat = new Intl.DateTimeFormat(undefined, {
  month: 'short',
  day: 'numeric',
  year: 'numeric',
});

export const WINDOW_NAMES: Record<UsageWindow, string> = {
  five_hour: '5-hour',
  daily: 'Daily',
  weekly: 'Weekly',
  monthly: 'Monthly',
};

function startOfDay(ts: number): number {
  const day = new Date(ts);
  day.setHours(0, 0, 0, 0);
  return day.getTime();
}

// The transcript's own 24-hour style, looking ahead: "19:00" today, "Sunday
// 10:30" within the week, then "Oct 4, 10:30", with the year once it differs.
export function formatResetTime(resetsAt: number, now: number): string {
  const time = timeFormat.format(resetsAt);
  // Rounded because a day across a DST change is not exactly DAY_MS long.
  const daysAhead = Math.round((startOfDay(resetsAt) - startOfDay(now)) / DAY_MS);
  if (daysAhead === 0) return time;
  if (daysAhead > 0 && daysAhead < 7) return `${weekdayFormat.format(resetsAt)} ${time}`;
  const sameYear = new Date(resetsAt).getFullYear() === new Date(now).getFullYear();
  const date = sameYear ? monthDayFormat.format(resetsAt) : fullDateFormat.format(resetsAt);
  return `${date}, ${time}`;
}

// "Weekly Opus limit reached"; a limit its harness did not place in a window
// is only a usage limit.
export function limitLabel({ window, model }: UsageLimit): string {
  if (!window) return 'Usage limit reached';
  return [WINDOW_NAMES[window], model, 'limit reached'].filter(Boolean).join(' ');
}

// Without a reset time nothing is known until the harness answers again, which
// every harness does on the next message.
export function resetLabel(resetsAt: number | undefined, now: number): string {
  return resetsAt === undefined
    ? 'Checked again with each message'
    : `Resets ${formatResetTime(resetsAt, now)}`;
}
