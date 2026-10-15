import { motion } from 'framer-motion';
import { Flame } from 'lucide-react';
import type { ReactNode } from 'react';
import { hasReportedTokens } from '../../../packages/remote/src';
import type { ProfileUsageSnapshot } from './profileShare';
import { useCountUp } from './useCountUp';

const compact = new Intl.NumberFormat(undefined, { notation: 'compact', maximumFractionDigits: 1 });
const EASE: [number, number, number, number] = [0.16, 1, 0.3, 1];

function dayCount(count: number) {
  return `${String(count)} ${count === 1 ? 'day' : 'days'}`;
}

export function StatsSkeleton() {
  return (
    <div
      role="status"
      aria-label="Reading your local activity"
      className="mt-5 grid grid-cols-2 gap-2 sm:grid-cols-4"
    >
      {[0, 1, 2, 3].map((block) => (
        <div
          key={block}
          className="h-[68px] animate-pulse rounded-xl bg-droid-elevated/60"
          style={{ animationDelay: `${String(block * 90)}ms` }}
        />
      ))}
    </div>
  );
}

function Stat({
  raw,
  format,
  label,
  index,
  prefix,
  icon,
}: {
  raw: number | null;
  format: (value: number) => string;
  label: string;
  index: number;
  prefix?: string;
  icon?: ReactNode;
}) {
  const value = useCountUp(raw ?? 0);
  return (
    <motion.div
      className="rounded-xl bg-droid-elevated/60 px-4 py-3"
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.28, ease: EASE, delay: 0.1 + index * 0.05 }}
    >
      <div className="flex items-center gap-1.5 text-[20px] font-semibold tabular-nums tracking-tight text-droid-text">
        {prefix && <span className="font-normal text-droid-text-muted">{prefix}</span>}
        {raw === null ? 'Unknown' : format(value)}
        {icon}
      </div>
      <div className="mt-0.5 text-[11px] text-droid-text-muted">{label}</div>
    </motion.div>
  );
}

export function HeroStats({ usage, color }: { usage: ProfileUsageSnapshot; color: string }) {
  const minimum = !usage.totals.tokensComplete;
  const measuredTokens = hasReportedTokens(usage);
  return (
    <div className="mt-5 grid grid-cols-2 gap-2 sm:grid-cols-4">
      <Stat
        index={0}
        raw={measuredTokens ? usage.lifetimeTokens : null}
        format={(v) => compact.format(v)}
        prefix={measuredTokens && minimum ? '≥' : undefined}
        label={measuredTokens && minimum ? 'Measured tokens' : 'Lifetime tokens'}
      />
      <Stat
        index={1}
        raw={usage.sessions}
        format={(v) => v.toLocaleString()}
        label="DROIDEX sessions"
      />
      <Stat
        index={2}
        raw={usage.currentStreak}
        format={dayCount}
        label="Current streak"
        icon={usage.currentStreak > 0 ? <Flame size={16} style={{ color }} /> : undefined}
      />
      <Stat index={3} raw={usage.longestStreak} format={dayCount} label="Longest streak" />
    </div>
  );
}

export function ProfileRanking({
  title,
  rows,
  color,
}: {
  title: string;
  rows: ProfileUsageSnapshot['models'];
  color: string;
}) {
  const top = Math.max(1, ...rows.map((row) => row.sessions));
  return (
    <section className="rounded-2xl bg-droid-surface p-5">
      <h3 className="mb-4 text-[13px] font-medium text-droid-text">{title}</h3>
      {rows.length === 0 ? (
        <p className="text-[12px] text-droid-text-muted">Nothing measured yet.</p>
      ) : (
        <ol className="space-y-3">
          {rows.map((row, index) => (
            <li key={row.name}>
              <div className="mb-1.5 flex items-center justify-between gap-3 text-[12px]">
                <span className="truncate text-droid-text-secondary" title={row.name}>
                  {row.name}
                </span>
                <span className="shrink-0 tabular-nums text-droid-text-muted">
                  {row.sessions.toLocaleString()} {row.sessions === 1 ? 'session' : 'sessions'}
                  {row.tokens > 0 && (
                    <>
                      {' · '}
                      {row.complete ? '' : '≥ '}
                      {compact.format(row.tokens)}
                    </>
                  )}
                </span>
              </div>
              <div className="h-1.5 overflow-hidden rounded-full bg-droid-elevated">
                <motion.div
                  className="h-full rounded-full"
                  style={{
                    background: `color-mix(in srgb, ${color} ${String(index === 0 ? 85 : 50)}%, var(--droid-elevated))`,
                  }}
                  initial={{ width: 0 }}
                  animate={{ width: `${String((row.sessions / top) * 100)}%` }}
                  transition={{ duration: 0.7, ease: EASE, delay: 0.2 + index * 0.06 }}
                />
              </div>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
