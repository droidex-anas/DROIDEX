import { motion } from 'framer-motion';
import { Flame } from 'lucide-react';
import type { ReactNode } from 'react';
import { hasReportedTokens } from '../../../packages/remote/src';
import type { ProfileUsageSnapshot } from './profileShare';
import { tokenGap } from './usageGap';
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
          className="h-16 animate-pulse rounded-lg bg-elevated/60"
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
      className="rounded-lg bg-elevated/60 px-4 py-3"
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.28, ease: EASE, delay: 0.1 + index * 0.05 }}
    >
      <div className="flex items-center gap-1.5 text-heading tabular-nums text-primary">
        {prefix && <span className="font-normal text-muted">{prefix}</span>}
        {raw === null ? 'Unknown' : format(value)}
        {icon}
      </div>
      <div className="mt-0.5 text-caption text-muted">{label}</div>
    </motion.div>
  );
}

export function HeroStats({ usage, color }: { usage: ProfileUsageSnapshot; color: string }) {
  const minimum = tokenGap(usage).isMaterial;
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
        icon={
          usage.currentStreak > 0 ? (
            <Flame className="size-icon-md" aria-hidden="true" style={{ color }} />
          ) : undefined
        }
      />
      <Stat index={3} raw={usage.longestStreak} format={dayCount} label="Longest streak" />
    </div>
  );
}
