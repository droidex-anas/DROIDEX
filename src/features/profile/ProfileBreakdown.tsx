import { motion } from 'framer-motion';
import { useState } from 'react';
import type { UsageBreakdown } from '../../../packages/remote/src/usage';
import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { cn } from '../../components/ui/cn';

const compact = new Intl.NumberFormat(undefined, { notation: 'compact', maximumFractionDigits: 1 });
// narrowSymbol keeps "$" in locales such as en-IN that would otherwise write "US$".
const compactUsd = new Intl.NumberFormat(undefined, {
  style: 'currency',
  currency: 'USD',
  currencyDisplay: 'narrowSymbol',
  notation: 'compact',
  maximumFractionDigits: 1,
});
const usd = new Intl.NumberFormat(undefined, {
  style: 'currency',
  currency: 'USD',
  currencyDisplay: 'narrowSymbol',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

// Under $1,000 a cost keeps its cents; "$14.9" reads like a typo, "$8.5K" does not.
function price(micros: number): string {
  const dollars = micros / 1_000_000;
  return dollars < 1_000 ? usd.format(dollars) : compactUsd.format(dollars);
}
const EASE: [number, number, number, number] = [0.16, 1, 0.3, 1];

function tokenCount(row: UsageBreakdown): string | null {
  if (row.events === 0 || (row.tokens === 0 && !row.tokensComplete)) return null;
  return compact.format(row.tokens);
}

function Measure({ value, complete }: { value: string | null; complete: boolean }) {
  return (
    <span className="w-20 shrink-0 text-right tabular-nums">
      {value === null ? (
        <span className="text-muted" aria-label="Not reported">
          —
        </span>
      ) : (
        <>
          {!complete && <span className="text-muted">≥ </span>}
          {value}
        </>
      )}
    </span>
  );
}

function BreakdownRow({
  row,
  index,
  top,
  color,
  isMostUsed,
}: {
  row: UsageBreakdown;
  index: number;
  top: number;
  color: string;
  isMostUsed: boolean;
}) {
  return (
    <li className={cn('rounded-lg px-3 py-2.5', isMostUsed && 'bg-elevated/60')}>
      <div className="flex items-center gap-3 text-body">
        <span className="flex min-w-0 flex-1 items-center gap-2">
          <span
            className={cn('truncate', isMostUsed ? 'text-primary' : 'text-secondary')}
            title={row.name}
          >
            {row.name}
          </span>
          {isMostUsed && <Badge tone="accent">Most used</Badge>}
        </span>
        <Measure value={row.sessions.toLocaleString()} complete />
        <Measure value={tokenCount(row)} complete={row.tokensComplete} />
        <Measure
          value={row.costMicrousd === null ? null : price(row.costMicrousd)}
          complete={row.costComplete}
        />
      </div>
      <div className="mt-2 h-1 overflow-hidden rounded-full bg-elevated">
        <motion.div
          className="h-full rounded-full"
          style={{
            background: `color-mix(in srgb, ${color} ${String(isMostUsed ? 85 : 50)}%, var(--elevated))`,
          }}
          initial={{ width: 0 }}
          animate={{ width: `${String((row.sessions / top) * 100)}%` }}
          transition={{ duration: 0.7, ease: EASE, delay: 0.2 + Math.min(index, 8) * 0.06 }}
        />
      </div>
    </li>
  );
}

/**
 * Sessions, tokens and cost per harness or model. `limit` collapses a long
 * list (models) behind a "Show all" toggle.
 */
export function ProfileBreakdown({
  title,
  rows,
  color,
  mostUsedId = null,
  limit,
}: {
  title: string;
  rows: UsageBreakdown[];
  color: string;
  mostUsedId?: string | null;
  limit?: number;
}) {
  const [expanded, setExpanded] = useState(false);
  const collapsible = limit !== undefined && rows.length > limit;
  const visible = collapsible && !expanded ? rows.slice(0, limit) : rows;
  const top = Math.max(1, ...rows.map((row) => row.sessions));
  const hasMinimum = rows.some((row) => !row.tokensComplete || !row.costComplete);

  return (
    <section className="rounded-xl bg-surface p-5">
      <div className="mb-2 flex items-center gap-3 px-3">
        <h3 className="flex-1 text-body-strong text-primary">
          {title}
          <span className="ml-2 font-normal text-muted">{rows.length.toLocaleString()}</span>
        </h3>
        {rows.length > 0 && (
          <div className="flex text-caption text-muted" aria-hidden="true">
            <span className="w-20 text-right">Sessions</span>
            <span className="ml-3 w-20 text-right">Tokens</span>
            <span className="ml-3 w-20 text-right">Cost</span>
          </div>
        )}
      </div>
      {rows.length === 0 ? (
        <p className="px-3 text-caption text-muted">Nothing measured yet.</p>
      ) : (
        <ol>
          {visible.map((row, index) => (
            <BreakdownRow
              key={row.id}
              row={row}
              index={index}
              top={top}
              color={color}
              isMostUsed={row.id === mostUsedId}
            />
          ))}
        </ol>
      )}
      {(collapsible || hasMinimum) && (
        <div className="mt-2 flex items-center justify-between gap-3 px-3">
          <p className="text-caption text-muted">
            {hasMinimum &&
              '≥ marks a minimum where some entries had no token or cost data. Cost is the reported price, otherwise the public API rate.'}
          </p>
          {collapsible && (
            <Button
              variant="ghost"
              size="sm"
              className="shrink-0"
              onClick={() => {
                setExpanded((value) => !value);
              }}
            >
              {expanded ? 'Show fewer' : `Show all ${rows.length.toLocaleString()}`}
            </Button>
          )}
        </div>
      )}
    </section>
  );
}
