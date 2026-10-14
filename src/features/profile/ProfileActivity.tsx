import { useMemo, useState } from 'react';
import type { ProfileUsageSnapshot } from './profileShare';

type Period = 'Daily' | 'Weekly' | 'Cumulative';
const compact = new Intl.NumberFormat(undefined, { notation: 'compact', maximumFractionDigits: 1 });
const PERIOD_FIELDS: Record<Period, 'tokens' | 'weekly' | 'cumulative'> = {
  Daily: 'tokens',
  Weekly: 'weekly',
  Cumulative: 'cumulative',
};
const PERIOD_SUFFIX: Record<Period, string> = {
  Daily: '',
  Weekly: ' this week',
  Cumulative: ' in the displayed period',
};

function dayKey(date: Date) {
  return `${String(date.getFullYear())}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

export function ProfileActivity({ usage }: { usage: ProfileUsageSnapshot }) {
  const [period, setPeriod] = useState<Period>('Daily');
  const [selected, setSelected] = useState<string>('');
  const cells = useMemo(() => {
    const totals = new Map(usage.days.map((day) => [day.date, day.tokens]));
    const today = new Date();
    const start = new Date(today);
    start.setDate(start.getDate() - 364 - start.getDay());
    const result = [];
    let cumulative = 0;
    let weekly = 0;
    for (let index = 0; index < 371; index += 1) {
      const date = new Date(start);
      date.setDate(start.getDate() + index);
      const key = dayKey(date);
      const tokens = totals.get(key) ?? 0;
      cumulative += tokens;
      if (index % 7 === 0) weekly = 0;
      weekly += tokens;
      result.push({ key, date, tokens, cumulative, weekly, future: key > dayKey(today) });
    }
    if (period === 'Weekly') {
      for (let index = 0; index < result.length; index += 7) {
        const total = result.slice(index, index + 7).reduce((sum, cell) => sum + cell.tokens, 0);
        for (const cell of result.slice(index, index + 7)) cell.weekly = total;
      }
    }
    return result;
  }, [usage.days, period]);
  const valueOf = (cell: (typeof cells)[number]) => cell[PERIOD_FIELDS[period]];
  const peak = Math.max(1, ...cells.map(valueOf));
  const focus = cells.find((cell) => cell.key === selected);
  const monthLabels = cells.filter((cell, index) => index % 7 === 0 && cell.date.getDate() <= 7);

  return (
    <section aria-label="Token activity" className="mt-9">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h3 className="text-[13px] font-medium text-droid-text">Token activity</h3>
        <div className="flex gap-1" aria-label="Activity period">
          {(['Daily', 'Weekly', 'Cumulative'] satisfies Period[]).map((option) => (
            <button
              key={option}
              aria-pressed={period === option}
              onClick={() => {
                setPeriod(option);
              }}
              className={`rounded-lg px-3 py-2 text-[12px] transition-colors focus-visible:bg-droid-active ${period === option ? 'bg-droid-elevated text-droid-text' : 'text-droid-text-muted hover:bg-droid-elevated'}`}
            >
              {option}
            </button>
          ))}
        </div>
      </div>
      <div className="overflow-x-auto pb-1">
        <div style={{ minWidth: 590 }}>
          <div
            className="grid gap-1"
            style={{ gridAutoFlow: 'column', gridTemplateRows: 'repeat(7,minmax(0,1fr))' }}
          >
            {cells.map((cell) => {
              const tokens = valueOf(cell);
              const label = `${cell.date.toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: 'numeric' })}: ${tokens.toLocaleString()} tokens${PERIOD_SUFFIX[period]}`;
              return (
                <button
                  key={cell.key}
                  disabled={cell.future}
                  aria-label={label}
                  title={label}
                  onFocus={() => {
                    setSelected(cell.key);
                  }}
                  onMouseEnter={() => {
                    setSelected(cell.key);
                  }}
                  onClick={() => {
                    setSelected(cell.key);
                  }}
                  className="aspect-square rounded-[3px] transition-colors focus-visible:ring-2 focus-visible:ring-droid-accent/30"
                  style={{
                    visibility: cell.future ? 'hidden' : 'visible',
                    background:
                      tokens > 0
                        ? `color-mix(in srgb, var(--droid-green) ${String(25 + 65 * Math.sqrt(tokens / peak))}%, var(--droid-elevated))`
                        : 'var(--droid-elevated)',
                  }}
                />
              );
            })}
          </div>
          <div className="relative mt-2 h-4 text-[10px] text-droid-text-muted">
            {monthLabels.map((cell) => (
              <span
                key={cell.key}
                className="absolute"
                style={{ left: `${String((cells.indexOf(cell) / cells.length) * 100)}%` }}
              >
                {cell.date.toLocaleDateString(undefined, { month: 'short' })}
              </span>
            ))}
          </div>
        </div>
      </div>
      <p aria-live="polite" className="mt-3 min-h-4 text-[11px] text-droid-text-muted">
        {focus
          ? `${focus.date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} · ${compact.format(valueOf(focus))} tokens${PERIOD_SUFFIX[period]}`
          : 'Select a day to explore your activity.'}
      </p>
      <p className="mt-1 text-[11px] leading-5 text-droid-text-muted">
        Daily activity records token increases observed by DROIDEX since{' '}
        {new Date(usage.trackingSince).toLocaleDateString()}. Earlier chat totals appear only in
        lifetime usage.
      </p>
    </section>
  );
}
