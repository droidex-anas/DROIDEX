import { useState, type CSSProperties } from 'react';
import { AlertTriangle, BarChart3, Check, Flame, RefreshCw } from 'lucide-react';
import {
  hasReportedTokens,
  usageFieldCoverage,
  type RemoteUsageSnapshot,
  type UsageSyncState,
  type UsageTotalField,
} from '../../packages/remote/src/usage';
import { pixelCreature } from '../../src/lib/pixelCreature';
import { dayKeyInTimeZone } from '../../src/features/profile/activityCalendar';
import { ActivityHeatmap } from './ActivityHeatmap';
import './usage.css';

const compact = new Intl.NumberFormat(undefined, { notation: 'compact', maximumFractionDigits: 1 });
const integer = new Intl.NumberFormat();
const usd = new Intl.NumberFormat(undefined, {
  style: 'currency',
  currency: 'USD',
  maximumFractionDigits: 2,
});

const SOURCES: { key: keyof RemoteUsageSnapshot['sync']['sources']; label: string }[] = [
  { key: 'jsonl', label: 'Claude Code and Codex' },
  { key: 'droid', label: 'Droid' },
  { key: 'openCode', label: 'OpenCode' },
];
const SOURCE_STATE: Record<UsageSyncState, string> = {
  indexing: 'Reading history',
  ready: 'Done',
  error: 'Needs attention',
};
const TOKEN_ROWS: { key: UsageTotalField; label: string }[] = [
  { key: 'inputTokens', label: 'Input' },
  { key: 'outputTokens', label: 'Output' },
  { key: 'cacheReadTokens', label: 'Cache read' },
  { key: 'cacheWriteTokens', label: 'Cache write' },
  { key: 'reasoningTokens', label: 'Reasoning' },
];
const COST_ROWS: { key: UsageTotalField; label: string; hint: string }[] = [
  { key: 'providerCostMicrousd', label: 'Reported cost', hint: 'Billed by pay-per-use providers.' },
  {
    key: 'estimatedCostMicrousd',
    label: 'API-equivalent estimate',
    hint: 'Subscription usage priced at public API rates. Not money spent.',
  },
];

function dayCount(count: number) {
  return `${integer.format(count)} ${count === 1 ? 'day' : 'days'}`;
}

// Partial coverage turns a value into a floor; null means no event reported
// the field at all, which is unknown rather than zero.
function TotalValue({
  usage,
  field,
  format,
}: {
  usage: RemoteUsageSnapshot;
  field: UsageTotalField;
  format: (value: number) => string;
}) {
  const value = usage.totals[field];
  if (value === null) return <span className="muted">Unknown</span>;
  const { partial } = usageFieldCoverage(usage, field);
  return (
    <span>
      {partial && <span className="muted">≥ </span>}
      {format(value)}
    </span>
  );
}

export function UsageScreen({
  usage,
  handle,
  ready,
  refresh,
}: {
  usage: RemoteUsageSnapshot | null;
  handle: string;
  ready: boolean;
  refresh: () => Promise<void>;
}) {
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');
  const { color } = pixelCreature(handle);
  const hasActivity =
    usage?.sync.status === 'ready' && (usage.totals.events > 0 || usage.sessions > 0);
  const reload = async () => {
    if (refreshing) return;
    setRefreshing(true);
    setError('');
    try {
      await refresh();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Unable to reach your laptop.');
    } finally {
      setRefreshing(false);
    }
  };

  return (
    <div className="usage" style={{ '--profile-color': color } as CSSProperties}>
      <div className="usage-heading">
        <div>
          <h1>Usage</h1>
          <p>Measured on your laptop. Private to you.</p>
        </div>
        <button
          className="icon-button"
          aria-label="Refresh usage"
          disabled={!ready || refreshing}
          onClick={() => void reload()}
        >
          <RefreshCw size={17} className={refreshing ? 'spin' : ''} />
        </button>
      </div>

      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}

      {!usage && !ready && <p className="notice">Usage loads once your laptop is connected.</p>}

      {!usage && ready && (
        <div className="usage-skeleton" role="status" aria-label="Asking your laptop for usage">
          {[0, 1, 2, 3].map((block) => (
            <span key={block} style={{ animationDelay: `${String(block * 90)}ms` }} />
          ))}
        </div>
      )}

      {usage && usage.sync.status !== 'ready' && (
        <section className="surface usage-sync" role="status">
          <h2>
            {usage.sync.status === 'error' ? 'Indexing needs attention' : 'Indexing your history'}
          </h2>
          <p className="muted">
            {usage.sync.status === 'error'
              ? 'A source could not be read on your laptop. Restart DROIDEX there, then refresh.'
              : 'Totals appear once every source is read. Refresh in a moment.'}
          </p>
          {usage.sync.status === 'indexing' && <div className="usage-progress" aria-hidden />}
          <ul>
            {SOURCES.map((source) => {
              const state = usage.sync.sources[source.key];
              return (
                <li key={source.key}>
                  {state === 'ready' && <Check size={14} className="ok" />}
                  {state === 'error' && <AlertTriangle size={14} className="bad" />}
                  {state === 'indexing' && <span className="usage-dot" aria-hidden />}
                  <span>{source.label}</span>
                  <span className="muted">{SOURCE_STATE[state]}</span>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {usage?.sync.status === 'ready' && !hasActivity && (
        <div className="empty">
          <BarChart3 size={26} strokeWidth={1.4} />
          <p>No activity yet.</p>
          <span className="muted">Start a task and its token usage appears here.</span>
        </div>
      )}

      {usage?.sync.status === 'ready' && hasActivity && <ReadyUsage usage={usage} color={color} />}
    </div>
  );
}

function ReadyUsage({ usage, color }: { usage: RemoteUsageSnapshot; color: string }) {
  const tokensReported = hasReportedTokens(usage);
  const minimum = tokensReported && !usage.totals.tokensComplete ? '≥ ' : '';
  const [openedAt] = useState(() => Date.now());
  let footnote = null;
  if (!tokensReported) {
    footnote = (
      <p className="usage-footnote muted">
        Token totals are unavailable because the indexed sessions did not report them.
      </p>
    );
  } else if (!usage.totals.tokensComplete) {
    footnote = (
      <p className="usage-footnote muted">
        Some providers did not report every token, so values marked ≥ are measured minimums.
      </p>
    );
  }
  return (
    <>
      <dl className="usage-stats">
        <div>
          <dd>
            {tokensReported ? `${minimum}${compact.format(usage.lifetimeTokens)}` : 'Unknown'}
          </dd>
          <dt>
            {tokensReported && !usage.totals.tokensComplete
              ? 'Tokens (minimum)'
              : 'Lifetime tokens'}
          </dt>
        </div>
        <div>
          <dd>{integer.format(usage.sessions)}</dd>
          <dt>DROIDEX sessions</dt>
        </div>
        <div>
          <dd>
            {dayCount(usage.currentStreak)}
            {usage.currentStreak > 0 && <Flame size={15} className="usage-flame" />}
          </dd>
          <dt>Current streak</dt>
        </div>
        <div>
          <dd>{dayCount(usage.longestStreak)}</dd>
          <dt>Longest streak</dt>
        </div>
      </dl>

      <ActivityHeatmap
        days={usage.days}
        endDay={dayKeyInTimeZone(openedAt, usage.timeZone)}
        trackingDay={dayKeyInTimeZone(usage.trackingSince, usage.timeZone)}
        color={color}
        tokensReported={tokensReported}
      />

      <section className="surface usage-list">
        <h2>Tokens</h2>
        <ul>
          {TOKEN_ROWS.map((row) => (
            <li key={row.key}>
              <span>{row.label}</span>
              <TotalValue usage={usage} field={row.key} format={(value) => integer.format(value)} />
            </li>
          ))}
        </ul>
      </section>

      <section className="surface usage-list">
        <h2>Cost</h2>
        <ul>
          {COST_ROWS.map((row) => (
            <li key={row.key}>
              <span>
                {row.label}
                <small className="muted">{row.hint}</small>
              </span>
              <TotalValue
                usage={usage}
                field={row.key}
                format={(value) => usd.format(value / 1_000_000)}
              />
            </li>
          ))}
        </ul>
      </section>

      <Ranking title="Models" rows={usage.models} tokensReported={tokensReported} />
      <Ranking title="Harnesses" rows={usage.harnesses} tokensReported={tokensReported} />

      {footnote}
    </>
  );
}

function Ranking({
  title,
  rows,
  tokensReported,
}: {
  title: string;
  rows: RemoteUsageSnapshot['models'];
  tokensReported: boolean;
}) {
  const top = Math.max(1, ...rows.map((row) => row.sessions));
  return (
    <section className="surface usage-list">
      <h2>{title}</h2>
      {rows.length ? (
        <ol>
          {rows.map((row, index) => (
            <li key={row.name}>
              <div className="usage-rank-label">
                <strong>{row.name}</strong>
                <span className="muted">
                  {integer.format(row.sessions)}
                  {tokensReported && (
                    <>
                      {' · '}
                      {row.complete ? '' : '≥ '}
                      {compact.format(row.tokens)}
                    </>
                  )}
                </span>
              </div>
              <div className="usage-track">
                <span
                  className={index === 0 ? 'lead' : ''}
                  style={{ width: `${String((row.sessions / top) * 100)}%` }}
                />
              </div>
            </li>
          ))}
        </ol>
      ) : (
        <p className="muted">Nothing measured yet.</p>
      )}
    </section>
  );
}
