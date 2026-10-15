import { Info } from 'lucide-react';
import { usageFieldCoverage, type UsageTotalField } from '../../../packages/remote/src/usage';
import type { ProfileUsageSnapshot } from './profileShare';

type Totals = ProfileUsageSnapshot['totals'];
type TokenKey = Extract<
  UsageTotalField,
  'inputTokens' | 'outputTokens' | 'cacheWriteTokens' | 'cacheReadTokens' | 'reasoningTokens'
>;
type CostKey = Extract<UsageTotalField, 'providerCostMicrousd' | 'estimatedCostMicrousd'>;

const TOKEN_ROWS: { key: TokenKey; label: string }[] = [
  { key: 'inputTokens', label: 'Input' },
  { key: 'outputTokens', label: 'Output' },
  { key: 'cacheReadTokens', label: 'Cache read' },
  { key: 'cacheWriteTokens', label: 'Cache write' },
  { key: 'reasoningTokens', label: 'Reasoning' },
];

const COST_ROWS: { key: CostKey; label: string; hint: string }[] = [
  {
    key: 'providerCostMicrousd',
    label: 'Reported cost',
    hint: 'What providers reported for pay-per-use chats.',
  },
  {
    key: 'estimatedCostMicrousd',
    label: 'API-equivalent estimate',
    hint: 'What subscription usage would cost at public API prices. Not money you spent.',
  },
];

const exact = new Intl.NumberFormat();
const usd = new Intl.NumberFormat(undefined, {
  style: 'currency',
  currency: 'USD',
  maximumFractionDigits: 2,
});

function Value({
  value,
  partial,
  format,
}: {
  value: number | null;
  partial: boolean;
  format: (value: number) => string;
}) {
  if (value === null) return <span className="text-droid-text-muted">Unknown</span>;
  return (
    <span className="tabular-nums text-droid-text">
      {partial && <span className="text-droid-text-muted">≥ </span>}
      {format(value)}
    </span>
  );
}

function Row({
  label,
  hint,
  value,
  usage,
  field,
  format,
}: {
  label: string;
  hint?: string;
  value: number | null;
  usage: ProfileUsageSnapshot;
  field: TokenKey | CostKey;
  format: (value: number) => string;
}) {
  const coverage = usageFieldCoverage(usage, field);
  return (
    <li className="flex items-baseline justify-between gap-4 py-2">
      <div className="min-w-0">
        <p className="text-[12px] text-droid-text-secondary">{label}</p>
        {hint && <p className="mt-0.5 text-[11px] leading-4 text-droid-text-muted">{hint}</p>}
      </div>
      <div className="shrink-0 text-right text-[12px]">
        <Value value={value} partial={coverage.partial} format={format} />
        {value !== null && coverage.partial && (
          <p className="mt-0.5 text-[10px] text-droid-text-muted">
            {coverage.percent}% of events reported
          </p>
        )}
      </div>
    </li>
  );
}

export function ProfileUsageDetails({ usage }: { usage: ProfileUsageSnapshot }) {
  const totals: Totals = usage.totals;
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <section className="rounded-2xl bg-droid-surface p-5">
        <div className="mb-2 flex items-baseline justify-between gap-3">
          <h3 className="text-[13px] font-medium text-droid-text">Tokens</h3>
          <span className="text-[11px] text-droid-text-muted">
            {exact.format(totals.events)} {totals.events === 1 ? 'event' : 'events'}
          </span>
        </div>
        <ul>
          {TOKEN_ROWS.map((row) => (
            <Row
              key={row.key}
              label={row.label}
              value={totals[row.key]}
              usage={usage}
              field={row.key}
              format={(value) => exact.format(value)}
            />
          ))}
        </ul>
      </section>
      <section className="flex flex-col rounded-2xl bg-droid-surface p-5">
        <h3 className="mb-2 text-[13px] font-medium text-droid-text">Cost</h3>
        <ul>
          {COST_ROWS.map((row) => (
            <Row
              key={row.key}
              label={row.label}
              hint={row.hint}
              value={totals[row.key]}
              usage={usage}
              field={row.key}
              format={(value) => usd.format(value / 1_000_000)}
            />
          ))}
        </ul>
        {!totals.tokensComplete && (
          <p className="mt-auto flex gap-1.5 pt-3 text-[11px] leading-[18px] text-droid-text-muted">
            <Info size={12} className="mt-[3px] shrink-0" />
            Some providers did not report every token, so totals marked ≥ are measured minimums.
          </p>
        )}
      </section>
    </div>
  );
}
