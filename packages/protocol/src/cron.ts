const CRON_BOUNDS = {
  minute: [0, 59],
  hour: [0, 23],
  dayOfMonth: [1, 31],
  month: [1, 12],
  dayOfWeek: [0, 7],
} as const;

type CronFieldName = keyof typeof CRON_BOUNDS;

interface CronRange {
  start: number;
  end: number;
  step: number;
}

export interface CronField {
  ranges: CronRange[];
  wildcard: boolean;
}

type CronIssue =
  | { kind: 'field-count' }
  | {
      kind: 'invalid-field' | 'invalid-step';
      field: CronFieldName;
      source: string;
      segment: string;
    };

type CronParseResult<T> = { ok: true; value: T } | { ok: false; issue: CronIssue };

/** Parse schedule syntax without choosing a timezone or requiring a future occurrence. */
export function parseCronExpression(
  expression: string,
): CronParseResult<Record<CronFieldName, CronField>> {
  const sources = expression.trim().split(/\s+/);
  const [minute, hour, dayOfMonth, month, dayOfWeek] = sources;
  if (sources.length !== 5 || !minute || !hour || !dayOfMonth || !month || !dayOfWeek) {
    return { ok: false, issue: { kind: 'field-count' } };
  }

  const minutes = parseCronField('minute', minute);
  if (!minutes.ok) return minutes;
  const hours = parseCronField('hour', hour);
  if (!hours.ok) return hours;
  const daysOfMonth = parseCronField('dayOfMonth', dayOfMonth);
  if (!daysOfMonth.ok) return daysOfMonth;
  const months = parseCronField('month', month);
  if (!months.ok) return months;
  const daysOfWeek = parseCronField('dayOfWeek', dayOfWeek);
  if (!daysOfWeek.ok) return daysOfWeek;

  return {
    ok: true,
    value: {
      minute: minutes.value,
      hour: hours.value,
      dayOfMonth: daysOfMonth.value,
      month: months.value,
      dayOfWeek: daysOfWeek.value,
    },
  };
}

function parseCronField(field: CronFieldName, source: string): CronParseResult<CronField> {
  const [minimum, maximum] = CRON_BOUNDS[field];
  const ranges: CronRange[] = [];
  for (const segment of source.split(',')) {
    const range = parseCronRange(segment, minimum, maximum);
    if (typeof range === 'string')
      return { ok: false, issue: { kind: range, field, source, segment } };
    ranges.push(range);
  }
  // Only a bare "*" is unrestricted for day-of-month/day-of-week matching.
  return { ok: true, value: { ranges, wildcard: source === '*' } };
}

function parseCronRange(
  segment: string,
  minimum: number,
  maximum: number,
): CronRange | 'invalid-field' | 'invalid-step' {
  const slash = segment.indexOf('/');
  const rangeSource = slash < 0 ? segment : segment.slice(0, slash);
  const step = slash < 0 ? 1 : cronNumber(segment.slice(slash + 1));
  if (step === null) return 'invalid-field';
  if (step === 0) return 'invalid-step';
  if (rangeSource === '*') return { start: minimum, end: maximum, step };

  const dash = rangeSource.indexOf('-');
  const start = cronNumber(dash < 0 ? rangeSource : rangeSource.slice(0, dash));
  const end = dash < 0 ? start : cronNumber(rangeSource.slice(dash + 1));
  if (start === null || end === null || start < minimum || end > maximum || start > end) {
    return 'invalid-field';
  }
  return { start, end, step };
}

function cronNumber(source: string): number | null {
  if (!/^\d+$/.test(source)) return null;
  const value = Number(source);
  return Number.isSafeInteger(value) ? value : null;
}
