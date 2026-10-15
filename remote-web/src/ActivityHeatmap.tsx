import { useMemo, useState } from 'react';
import {
  activityCalendar,
  heatFill,
  heatLevel,
  dateFromDayKey,
  type ActivityDay,
  type CalendarDay,
} from '../../src/features/profile/activityCalendar';
import './heatmap.css';

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

function cellLevel(tokensReported: boolean, recorded: boolean, tokens: number, peak: number) {
  if (tokensReported) return heatLevel(tokens, peak);
  return recorded ? 2 : 0;
}

export function ActivityHeatmap({
  days,
  endDay,
  trackingDay,
  color,
  tokensReported,
  className = '',
}: {
  days: readonly ActivityDay[];
  endDay: string;
  trackingDay: string;
  color: string;
  tokensReported: boolean;
  className?: string;
}) {
  const cells = useMemo(
    () => activityCalendar(days, dateFromDayKey(endDay), WEEKS),
    [days, endDay],
  );
  const recordedDays = useMemo(() => new Set(days.map((day) => day.date)), [days]);
  const [focus, setFocus] = useState<CalendarDay | null>(null);
  const peak = Math.max(1, ...cells.map((cell) => cell.tokens));
  const yearTotal = cells.reduce((sum, cell) => sum + cell.tokens, 0);
  const yearComplete = cells.every((cell) => cell.complete);
  const activeDays = cells.filter((cell) => !cell.future && recordedDays.has(cell.key)).length;
  const months = cells.filter((cell, index) => index % 7 === 0 && cell.date.getDate() <= 7);
  let focusText = `Tracked since ${formatDay(dateFromDayKey(trackingDay))}`;
  if (focus) {
    focusText = tokensReported
      ? `${formatDay(focus.date)} · ${minimum(focus.complete)}${compact.format(focus.tokens)} tokens`
      : `${formatDay(focus.date)} · ${unavailableDay(recordedDays.has(focus.key))}`;
  }
  return (
    <section className={`surface heatmap ${className}`}>
      <div className="heatmap-heading">
        <h2>
          {tokensReported
            ? `${minimum(yearComplete)}${compact.format(yearTotal)} tokens in the last year`
            : 'Token activity unavailable'}
        </h2>
        <span className="muted">
          {integer.format(activeDays)} {tokensReported ? 'active' : 'indexed'}{' '}
          {activeDays === 1 ? 'day' : 'days'}
        </span>
      </div>
      <div className="heatmap-scroll">
        <div className="heatmap-body">
          <div className="heatmap-months" aria-hidden>
            {months.map((cell) => (
              <span
                key={cell.key}
                style={{ left: `${String((cells.indexOf(cell) / cells.length) * 100)}%` }}
              >
                {cell.date.toLocaleDateString(undefined, { month: 'short' })}
              </span>
            ))}
          </div>
          <div
            className="heatmap-grid"
            role="img"
            aria-label={
              tokensReported
                ? `${minimum(yearComplete)}${integer.format(yearTotal)} tokens across ${String(activeDays)} active days in the last year`
                : `Token counts unavailable across ${String(activeDays)} indexed days in the last year`
            }
            onMouseLeave={() => {
              setFocus(null);
            }}
          >
            {cells.map((cell, index) => (
              <span
                key={cell.key}
                className={cell.future ? 'future' : ''}
                title={
                  tokensReported
                    ? `${formatDay(cell.date)}: ${minimum(cell.complete)}${integer.format(cell.tokens)} tokens`
                    : `${formatDay(cell.date)}: ${unavailableDay(recordedDays.has(cell.key))}`
                }
                onMouseEnter={() => {
                  setFocus(cell);
                }}
                style={{
                  background: heatFill(
                    cellLevel(tokensReported, recordedDays.has(cell.key), cell.tokens, peak),
                    color,
                    'var(--droid-elevated)',
                  ),
                  animationDelay: `${String(Math.min(Math.floor(index / 7) * 8, 420))}ms`,
                }}
              />
            ))}
          </div>
        </div>
      </div>
      <div className="heatmap-footer">
        <span aria-live="polite">{focusText}</span>
        <span className="heatmap-legend" aria-hidden>
          {tokensReported ? (
            <>
              Less
              {[0, 1, 2, 3, 4].map((level) => (
                <i
                  key={level}
                  style={{ background: heatFill(level, color, 'var(--droid-elevated)') }}
                />
              ))}
              More
            </>
          ) : (
            <>
              <i style={{ background: heatFill(2, color, 'var(--droid-elevated)') }} />
              Indexed activity
            </>
          )}
        </span>
      </div>
    </section>
  );
}
