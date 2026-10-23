import { useMemo, useState } from 'react';
import { useReducedMotion } from 'framer-motion';
import {
  activityCalendar,
  heatFill,
  heatLevel,
  dateFromDayKey,
  type ActivityDay,
} from '../../src/features/profile/activityCalendar';
import { cn } from '../../src/components/ui/cn';

const compact = new Intl.NumberFormat(undefined, { notation: 'compact', maximumFractionDigits: 1 });
const integer = new Intl.NumberFormat();
const WEEKS = 53;

function formatDay(date: Date) {
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

function minimum(complete: boolean) {
  return complete ? '' : '≥ ';
}

function unavailableDay(recorded: boolean) {
  return recorded ? 'activity indexed; token count unavailable' : 'no indexed activity';
}

export function ActivityHeatmap({
  days,
  endDay,
  trackingDay,
  color,
  tokensReported,
}: {
  days: readonly ActivityDay[];
  endDay: string;
  trackingDay: string;
  color: string;
  tokensReported: boolean;
}) {
  const cells = useMemo(
    () => activityCalendar(days, dateFromDayKey(endDay), WEEKS),
    [days, endDay],
  );
  const recordedDays = useMemo(() => new Set(days.map((day) => day.date)), [days]);
  const [selected, setSelected] = useState('');
  const [hovered, setHovered] = useState('');
  const reduceMotion = useReducedMotion();
  const peak = Math.max(1, ...cells.map((cell) => cell.tokens));
  const yearTotal = cells.reduce((sum, cell) => sum + cell.tokens, 0);
  const yearComplete = cells.every((cell) => cell.tokensComplete);
  const activeDays = cells.filter((cell) => !cell.future && recordedDays.has(cell.key)).length;
  const months = cells.filter((cell, index) => index % 7 === 0 && cell.date.getDate() <= 7);
  const dayLabel = (cell: (typeof cells)[number]) =>
    tokensReported
      ? `${formatDay(cell.date)}: ${minimum(cell.tokensComplete)}${integer.format(cell.tokens)} tokens`
      : `${formatDay(cell.date)}: ${unavailableDay(recordedDays.has(cell.key))}`;

  // Hover previews a day in the readout; a click or keyboard focus selects it.
  const focus = cells.find((cell) => cell.key === (hovered || selected));
  let readout = `Tracking since ${formatDay(dateFromDayKey(trackingDay))}`;
  if (focus) {
    const date = focus.date.toLocaleDateString(undefined, {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
    });
    readout = tokensReported
      ? `${date} · ${minimum(focus.tokensComplete)}${compact.format(focus.tokens)} tokens`
      : `${date} · ${unavailableDay(recordedDays.has(focus.key))}`;
  }

  return (
    <section aria-label="Token activity" className="droid-rise rounded-2xl bg-surface p-4 md:p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <h2 className="text-body-strong text-primary">
          {tokensReported
            ? `${minimum(yearComplete)}${compact.format(yearTotal)} tokens in the last year`
            : 'Token activity unavailable'}
        </h2>
        <span className="text-caption tabular-nums text-muted">
          {integer.format(activeDays)} {tokensReported ? 'active' : 'indexed'}{' '}
          {activeDays === 1 ? 'day' : 'days'}
        </span>
      </div>

      {/* A right-to-left scroller starts narrow screens at the latest weeks. */}
      <div dir="rtl" className="mt-4 overflow-x-auto pb-1">
        <div dir="ltr" style={{ minWidth: 560 }}>
          <div className="relative mb-1.5 h-3.5 text-caption text-muted" aria-hidden>
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
          <div
            className="grid grid-flow-col grid-rows-7 gap-0.5"
            onMouseLeave={() => {
              setHovered('');
            }}
          >
            {cells.map((cell, index) => {
              const recorded = recordedDays.has(cell.key);
              const isSelected = selected === cell.key;
              let level = 0;
              if (tokensReported) level = heatLevel(cell.tokens, peak);
              else if (recorded) level = 2;
              return (
                <button
                  key={cell.key}
                  disabled={cell.future}
                  aria-label={dayLabel(cell)}
                  aria-pressed={isSelected}
                  title={dayLabel(cell)}
                  onFocus={() => {
                    setSelected(cell.key);
                  }}
                  onMouseEnter={() => {
                    setHovered(cell.key);
                  }}
                  onClick={() => {
                    setSelected(cell.key);
                  }}
                  className={cn(
                    'aspect-square rounded-xs transition-transform duration-150',
                    cell.future ? 'invisible' : 'motion-safe:hover:scale-110',
                    isSelected && 'relative z-10 scale-125 shadow-lg',
                  )}
                  style={{
                    background: heatFill(level, color, 'var(--elevated)'),
                    ...(reduceMotion
                      ? {}
                      : {
                          // `backwards`: a held end frame would pin `transform` over the selected scale.
                          animation: 'profile-cell-in 0.35s cubic-bezier(0.16,1,0.3,1) backwards',
                          animationDelay: `${String(Math.min(Math.floor(index / 7) * 8, 420))}ms`,
                        }),
                  }}
                />
              );
            })}
          </div>
        </div>
      </div>

      <div className="mt-3 flex flex-wrap items-center justify-between gap-3 text-caption text-muted">
        <p aria-live="polite" className="tabular-nums">
          {readout}
        </p>
        <div className="flex items-center gap-1" aria-hidden>
          {tokensReported ? (
            <>
              Less
              {[0, 1, 2, 3, 4].map((level) => (
                <span
                  key={level}
                  className="mx-px size-2.5 rounded-xs"
                  style={{ background: heatFill(level, color, 'var(--elevated)') }}
                />
              ))}
              More
            </>
          ) : (
            <>
              <span
                className="mx-px size-2.5 rounded-xs"
                style={{ background: heatFill(2, color, 'var(--elevated)') }}
              />
              Indexed activity
            </>
          )}
        </div>
      </div>
    </section>
  );
}
