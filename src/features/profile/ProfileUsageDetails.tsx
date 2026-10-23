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

const COST_ROWS: { key: CostKey; label: string; hint: string; missing: string }[] = [
  {
    key: 'providerCostMicrousd',
    label: 'Reported cost',
    hint: 'What providers reported for pay-per-use chats.',
    missing: 'unreported',
  },
  {
    key: 'estimatedCostMicrousd',
    label: 'API-equivalent estimate',
    hint: 'What subscription usage would cost at public API prices. Not money you spent.',
    missing: 'not priced',
  },
];

const exact = new Intl.NumberFormat();
// narrowSymbol keeps "$" in locales such as en-IN that would otherwise write "US$".
const usd = new Intl.NumberFormat(undefined, {
  style: 'currency',
  currency: 'USD',
  currencyDisplay: 'narrowSymbol',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

function plural(count: number, word: string): string {
  return `${exact.format(count)} ${count === 1 ? word : `${word}s`}`;
}

function TokenRow({
  label,
  usage,
  field,
}: {
  label: string;
  usage: ProfileUsageSnapshot;
  field: TokenKey;
}) {
  const value = usage.totals[field];
  const gap = fieldGap(usage, field);
  return (
    <li className="flex items-baseline justify-between gap-4 py-2">
      <p className="min-w-0 text-body text-secondary">{label}</p>
      <div className="shrink-0 text-right text-body">
        {value === null ? (
          <span className="text-muted">Unknown</span>
        ) : (
          <span className="tabular-nums text-primary">
            {gap.isMaterial && <span className="text-muted">≥ </span>}
            {exact.format(value)}
          </span>
        )}
        {value !== null && gap.missingEvents > 0 && (
          <p className="mt-0.5 text-caption text-muted">
            {plural(gap.missingEvents, 'event')} unreported
          </p>
        )}
      </div>
    </li>
  );
}

// A price reads badly behind "≥", so a partial cost says "at least" in words.
function CostRow({
  label,
  hint,
  missing,
  usage,
  field,
}: {
  label: string;
  hint: string;
  missing: string;
  usage: ProfileUsageSnapshot;
  field: CostKey;
}) {
  const micros = usage.totals[field];
  const gap = fieldGap(usage, field);
  return (
    <li className="flex items-baseline justify-between gap-4 py-2">
      <div className="min-w-0">
        <p className="text-body text-secondary">{label}</p>
        <p className="mt-0.5 text-caption text-muted">{hint}</p>
      </div>
      <div className="shrink-0 text-right">
        {micros === null ? (
          <span className="text-body text-muted">Unknown</span>
        ) : (
          <p className="text-body-strong tabular-nums text-primary">
            {gap.isMaterial && <span className="text-caption text-muted">at least </span>}
            {usd.format(micros / 1_000_000)}
          </p>
        )}
        {micros !== null && gap.missingEvents > 0 && (
          <p className="mt-0.5 text-caption text-muted">
            {plural(gap.missingEvents, 'event')} {missing}
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
            <TokenRow key={row.key} label={row.label} usage={usage} field={row.key} />
          ))}
        </ul>
      </section>
      <section className="flex flex-col rounded-xl bg-surface p-5">
        <h3 className="mb-2 text-body-strong text-primary">Cost</h3>
        <ul>
          {COST_ROWS.map((row) => (
            <CostRow
              key={row.key}
              label={row.label}
              hint={row.hint}
              missing={row.missing}
              usage={usage}
              field={row.key}
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
