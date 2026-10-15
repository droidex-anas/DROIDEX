// The day shape shared by the local usage snapshot and the public profile.
// `complete: false` means some events that day had no token counts, so the
// total is a measured minimum.
export interface ActivityDay {
  date: string;
  tokens: number;
  complete: boolean;
}

export interface CalendarDay {
  key: string;
  date: Date;
  tokens: number;
  complete: boolean;
  future: boolean;
}

// Day keys are local calendar dates, matching how the desktop records usage.
function dayKey(date: Date): string {
  return `${String(date.getFullYear())}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

export function dayKeyInTimeZone(timestamp: number, timeZone: string): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(timestamp);
  const value = (type: 'year' | 'month' | 'day') =>
    parts.find((part) => part.type === type)?.value ?? '';
  const key = `${value('year')}-${value('month')}-${value('day')}`;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(key)) throw new Error('Usage day could not be resolved.');
  return key;
}

// Converts an already-localized calendar key into the viewer's local Date
// without allowing the browser timezone to move it to an adjacent day.
export function dateFromDayKey(key: string): Date {
  const date = new Date(`${key}T12:00:00`);
  if (!Number.isFinite(date.getTime()) || dayKey(date) !== key) {
    throw new Error('Usage day is invalid.');
  }
  return date;
}

// Sunday-first week columns, the last one containing `end`, as on GitHub.
export function activityCalendar(
  days: readonly ActivityDay[],
  end: Date,
  weeks: number,
): CalendarDay[] {
  const recorded = new Map(days.map((day) => [day.date, day]));
  const endKey = dayKey(end);
  const start = new Date(end.getFullYear(), end.getMonth(), end.getDate());
  start.setDate(start.getDate() - (weeks - 1) * 7 - start.getDay());
  const cells: CalendarDay[] = [];
  for (let index = 0; index < weeks * 7; index += 1) {
    const date = new Date(start);
    date.setDate(start.getDate() + index);
    const key = dayKey(date);
    const day = recorded.get(key);
    cells.push({
      key,
      date,
      tokens: day?.tokens ?? 0,
      complete: day?.complete ?? true,
      future: key > endKey,
    });
  }
  return cells;
}

// Four GitHub-style intensity steps; square root keeps quiet days visible
// next to a single huge day.
export function heatLevel(tokens: number, peak: number): 0 | 1 | 2 | 3 | 4 {
  if (tokens <= 0 || peak <= 0) return 0;
  const ratio = Math.sqrt(tokens / peak);
  if (ratio > 0.75) return 4;
  if (ratio > 0.5) return 3;
  if (ratio > 0.25) return 2;
  return 1;
}

export const HEAT_MIX_PERCENT = [0, 28, 48, 70, 94] as const;

export function heatFill(level: number, color: string, base: string): string {
  if (level === 0) return base;
  return `color-mix(in srgb, ${color} ${String(HEAT_MIX_PERCENT[level])}%, ${base})`;
}
