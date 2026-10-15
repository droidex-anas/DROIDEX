import { motion, useReducedMotion } from 'framer-motion';
import { useMemo, useState } from 'react';
import {
  activityCalendar,
  dateFromDayKey,
  dayKeyInTimeZone,
  heatFill,
  heatLevel,
} from './activityCalendar';
import type { ProfileUsageSnapshot } from './profileShare';

type Period = 'Daily' | 'Weekly' | 'Cumulative';
const PERIODS: Period[] = ['Daily', 'Weekly', 'Cumulative'];
const PERIOD_SUFFIX: Record<Period, string> = {
  Daily: '',
  Weekly: ' that week',
  Cumulative: ' so far',
};
const WEEKS = 53;
const DAY_LABELS = ['', 'Mon', '', 'Wed', '', 'Fri', ''];
const compact = new Intl.NumberFormat(undefined, { notation: 'compact', maximumFractionDigits: 1 });

function unavailableDay(recorded: boolean) {
  return recorded ? 'activity indexed; token count unavailable' : 'no indexed activity';
}

export function ProfileActivity({
  usage,
  color,
  tokensReported,
}: {
  usage: ProfileUsageSnapshot;
  color: string;
  tokensReported: boolean;
}) {
  const [period, setPeriod] = useState<Period>('Daily');
  const [selected, setSelected] = useState('');
  const reduceMotion = useReducedMotion();
  const recordedDays = useMemo(() => new Set(usage.days.map((day) => day.date)), [usage.days]);
  const endDay = dayKeyInTimeZone(Date.now(), usage.timeZone);
  const cells = useMemo(() => {
    const days = activityCalendar(usage.days, dateFromDayKey(endDay), WEEKS);
    let cumulative = 0;
    let cumulativeComplete = true;
    return days.map((day, index) => {
      cumulative += day.tokens;
      cumulativeComplete &&= day.complete;
      const week = days.slice(index - (index % 7), index - (index % 7) + 7);
      const totals: Record<Period, number> = {
        Daily: day.tokens,
        Weekly: week.reduce((sum, cell) => sum + cell.tokens, 0),
        Cumulative: cumulative,
      };
      const exact: Record<Period, boolean> = {
        Daily: day.complete,
        Weekly: week.every((cell) => cell.complete),
        Cumulative: cumulativeComplete,
      };
      return { ...day, totals, exact, recorded: recordedDays.has(day.key) };
    });
  }, [endDay, recordedDays, usage.days]);
  const peak = Math.max(1, ...cells.map((cell) => cell.totals[period]));
  const last = cells[cells.length - 1];
  const minimum = (isExact: boolean) => (isExact ? '' : '≥ ');
  const focus = cells.find((cell) => cell.key === selected);
  const months = cells.filter((cell, index) => index % 7 === 0 && cell.date.getDate() <= 7);
  const indexedDays = cells.filter((cell) => !cell.future && cell.recorded).length;
  const isEmpty = tokensReported && last.totals.Cumulative === 0;
  let summary = 'No token activity in the last year yet.';
  if (!tokensReported) {
    summary = `Token counts unavailable · ${indexedDays.toLocaleString()} indexed ${indexedDays === 1 ? 'day' : 'days'} in the last year`;
  } else if (!isEmpty) {
    summary = `${minimum(last.exact.Cumulative)}${compact.format(last.totals.Cumulative)} tokens in the last year · peak day ${minimum(usage.totals.tokensComplete)}${compact.format(usage.peakDayTokens)}`;
  }
  let focusSummary = `Tracking since ${dateFromDayKey(
    dayKeyInTimeZone(usage.trackingSince, usage.timeZone),
  ).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}`;
  if (focus) {
    const date = focus.date.toLocaleDateString(undefined, {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
    });
    if (tokensReported) {
      focusSummary = `${date} · ${minimum(focus.exact[period])}${compact.format(focus.totals[period])} tokens${PERIOD_SUFFIX[period]}${focus.exact[period] ? '' : ' (measured minimum)'}`;
    } else {
      focusSummary = `${date} · ${focus.recorded ? 'Activity indexed; token count unavailable' : 'No indexed activity'}`;
    }
  }

  return (
    <section aria-label="Token activity" className="rounded-2xl bg-droid-surface p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-[13px] font-medium text-droid-text">Activity</h3>
          <p className="mt-0.5 text-[12px] text-droid-text-muted">{summary}</p>
        </div>
        {tokensReported && (
          <div
            className="flex gap-0.5 rounded-lg bg-droid-elevated/70 p-0.5"
            aria-label="Activity period"
          >
            {PERIODS.map((option) => {
              const active = period === option;
              return (
                <button
                  key={option}
                  aria-pressed={active}
                  onClick={() => {
                    setPeriod(option);
                  }}
                  className={`relative h-7 rounded-md px-3 text-[12px] transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-droid-accent/40 ${
                    active
                      ? 'text-droid-text'
                      : 'text-droid-text-muted hover:text-droid-text-secondary'
                  }`}
                >
                  {active && (
                    <motion.span
                      layoutId="profile-activity-period"
                      className="absolute inset-0 rounded-md bg-droid-active"
                      transition={{ type: 'spring', stiffness: 520, damping: 38 }}
                    />
                  )}
                  <span className="relative z-10">{option}</span>
                </button>
              );
            })}
          </div>
        )}
      </div>

      <div className="mt-5 overflow-x-auto pb-1">
        <div className="flex gap-2" style={{ minWidth: 660 }}>
          <div className="mt-5 grid shrink-0 grid-rows-7 gap-[3px] text-[10px] leading-none text-droid-text-muted">
            {DAY_LABELS.map((label, index) => (
              <span key={index} className="flex items-center">
                {label}
              </span>
            ))}
          </div>
          <div className="min-w-0 flex-1">
            <div className="relative mb-1.5 h-3.5 text-[10px] text-droid-text-muted">
              {months.map((cell) => (
                <span
                  key={cell.key}
                  className="absolute"
                  style={{ left: `${String((cells.indexOf(cell) / cells.length) * 100)}%` }}
                >
                  {cell.date.toLocaleDateString(undefined, { month: 'short' })}
                </span>
              ))}
            </div>
            <div className="grid grid-flow-col grid-rows-7 gap-[3px]">
              {cells.map((cell, index) => {
                const tokens = cell.totals[period];
                const date = cell.date.toLocaleDateString(undefined, {
                  month: 'long',
                  day: 'numeric',
                  year: 'numeric',
                });
                const label = tokensReported
                  ? `${date}: ${minimum(cell.exact[period])}${tokens.toLocaleString()} tokens${PERIOD_SUFFIX[period]}`
                  : `${date}: ${unavailableDay(cell.recorded)}`;
                const isSelected = selected === cell.key;
                let level = 0;
                if (tokensReported) level = heatLevel(tokens, peak);
                else if (cell.recorded) level = 2;
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
                    className={`aspect-square rounded-[3px] transition-transform duration-150 focus-visible:outline-none ${
                      cell.future ? 'invisible' : 'motion-safe:hover:scale-125'
                    } ${isSelected ? 'relative z-10 ring-2 ring-droid-text/25' : ''}`}
                    style={{
                      background: heatFill(level, color, 'var(--droid-elevated)'),
                      ...(reduceMotion
                        ? {}
                        : {
                            animation: 'profile-cell-in 0.35s cubic-bezier(0.16,1,0.3,1) both',
                            animationDelay: `${String(Math.min(Math.floor(index / 7) * 8, 420))}ms`,
                          }),
                    }}
                  />
                );
              })}
            </div>
          </div>
        </div>
      </div>

      <div className="mt-3 flex flex-wrap items-center justify-between gap-3 text-[11px] text-droid-text-muted">
        <p aria-live="polite" className="tabular-nums">
          {focusSummary}
        </p>
        <div className="flex items-center gap-1" aria-hidden>
          {tokensReported ? (
            <>
              Less
              {[0, 1, 2, 3, 4].map((level) => (
                <span
                  key={level}
                  className="mx-px h-2.5 w-2.5 rounded-[3px]"
                  style={{ background: heatFill(level, color, 'var(--droid-elevated)') }}
                />
              ))}
              More
            </>
          ) : (
            <>
              <span
                className="mx-px h-2.5 w-2.5 rounded-[3px]"
                style={{ background: heatFill(2, color, 'var(--droid-elevated)') }}
              />
              Indexed activity
            </>
          )}
        </div>
      </div>
    </section>
  );
}
