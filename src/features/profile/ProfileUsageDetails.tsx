import { Info } from 'lucide-react';
import type { UsageTotalField } from '../../../packages/remote/src/usage';
import type { ProfileUsageSnapshot } from './profileShare';
import { fieldGap, MATERIAL_GAP_SHARE, tokenGap } from './usageGap';

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
  if (value === null) return <span className="text-muted">Unknown</span>;
  return (
    <span className="tabular-nums text-primary">
      {partial && <span className="text-muted">≥ </span>}
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
  const gap = fieldGap(usage, field);
  return (
    <li className="flex items-baseline justify-between gap-4 py-2">
      <div className="min-w-0">
        <p className="text-body text-secondary">{label}</p>
        {hint && <p className="mt-0.5 text-caption text-muted">{hint}</p>}
      </div>
      <div className="shrink-0 text-right text-body">
        <Value value={value} partial={gap.isMaterial} format={format} />
        {value !== null && gap.missingEvents > 0 && (
          <p className="mt-0.5 text-caption text-muted">
            {exact.format(gap.missingEvents)} {gap.missingEvents === 1 ? 'event' : 'events'}{' '}
            unreported
          </p>
        )}
      </div>
    </li>
  );
}

function tokenGapNote(usage: ProfileUsageSnapshot): string | null {
  const gap = tokenGap(usage);
  if (gap.missingEvents === 0) return null;
  if (gap.isMaterial) {
    return 'Some providers did not report every token, so totals marked ≥ are measured minimums.';
  }
  const partial = usage.harnesses.filter((harness) => !harness.tokensComplete);
  const source = partial.length === 1 ? `${partial[0].name} ` : '';
  const entries = gap.missingEvents === 1 ? 'entry' : 'entries';
  return `${exact.format(gap.missingEvents)} ${source}${entries} had no token counts. That is under ${String(MATERIAL_GAP_SHARE * 100)}% of events, so totals show as measured.`;
}

export function ProfileUsageDetails({ usage }: { usage: ProfileUsageSnapshot }) {
  const totals: Totals = usage.totals;
  const note = tokenGapNote(usage);
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <section className="rounded-xl bg-surface p-5">
        <div className="mb-2 flex items-baseline justify-between gap-3">
          <h3 className="text-body-strong text-primary">Tokens</h3>
          <span className="text-caption text-muted">
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
      <section className="flex flex-col rounded-xl bg-surface p-5">
        <h3 className="mb-2 text-body-strong text-primary">Cost</h3>
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
        {note && (
          <p className="mt-auto flex gap-1.5 pt-3 text-caption text-muted">
            <Info className="mt-px size-icon-sm shrink-0" aria-hidden="true" />
            {note}
          </p>
        )}
      </section>
    </div>
  );
}
