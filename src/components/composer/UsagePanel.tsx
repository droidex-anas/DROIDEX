import { useState, type ReactNode } from 'react';
import { Gauge, X } from '@droidex/icons';

import { PROVIDER_LABELS } from '../../features/providers/providerIdentity';
import {
  extraLabel,
  formatDuration,
  meterLabel,
  paceLabel,
  updatedLabel,
  usedLabel,
} from '../../features/usage/usageCopy';
import { usagePace } from '../../features/usage/usagePace';
import { refreshUsage } from '../../features/usage/useProviderUsage';
import { formatResetTime } from '../../lib/usageLimit';
import type { ProviderKind, ProviderUsage, UsageMeter } from '../../types/bridge';
import { ComposerTab } from './ComposerTab';
import { ACTION_CLASS, ManageUsageButton } from './UsageLimitTab';

// What /usage shows: the current harness's account windows, each with how
// much is used, when it resets and how it is pacing, in the limit tab's slot.
export function UsagePanel({
  provider,
  usage,
  reachable,
  now,
  onClose,
}: {
  provider: ProviderKind;
  usage: ProviderUsage | undefined;
  // Whether the agent runtime can be asked; without it /usage shows only what
  // the app already knows.
  reachable: boolean;
  now: number;
  onClose: () => void;
}) {
  // Refreshing until the answer arrives as a new snapshot.
  const [refreshedFrom, setRefreshedFrom] = useState<ProviderUsage | undefined | null>(null);
  const refreshing = refreshedFrom !== null && refreshedFrom === usage;
  const extra = usage?.extra && extraLabel(usage.extra);
  // The oldest window's time, so the line never claims one a read did not refresh.
  const updatedAt = usage?.meters.length
    ? Math.min(...usage.meters.map((meter) => meter.updatedAt))
    : undefined;

  return (
    <ComposerTab>
      <div
        role="region"
        aria-label={`${PROVIDER_LABELS[provider]} usage`}
        className="flex min-w-0 flex-col gap-1 text-[11px]"
      >
        <div className="flex min-w-0 flex-wrap items-center gap-x-4">
          <div className="flex min-w-0 flex-auto items-center gap-1.5 px-1.5 py-1">
            <span className="shrink-0 text-droid-text-muted">
              <Gauge className="h-3.5 w-3.5" strokeWidth={2} />
            </span>
            <span className="truncate font-medium text-droid-text">
              {PROVIDER_LABELS[provider]} usage
            </span>
          </div>
          <div className="ml-auto flex shrink-0 items-center gap-1 tabular-nums">
            {updatedAt !== undefined && (
              <>
                <span className="pl-1.5 text-droid-text-muted">
                  {updatedLabel(updatedAt, now)}
                  {usage?.stale && ' · Couldn’t refresh'}
                </span>
                <span className="pl-1 text-droid-text-muted">·</span>
              </>
            )}
            <button
              type="button"
              disabled={refreshing}
              onClick={() => {
                if (refreshUsage(provider, true, true)) setRefreshedFrom(usage);
              }}
              className={`${ACTION_CLASS} text-droid-text-secondary disabled:opacity-60`}
            >
              {refreshing ? 'Refreshing…' : 'Refresh'}
            </button>
            <button
              type="button"
              aria-label="Close usage"
              onClick={onClose}
              className={`${ACTION_CLASS} text-droid-text-muted`}
            >
              <X className="h-3.5 w-3.5" strokeWidth={2} />
            </button>
          </div>
        </div>
        <UsageBody provider={provider} usage={usage} reachable={reachable} now={now} />
        {extra && <div className="px-1.5 pb-0.5 text-droid-text-muted">{extra}</div>}
      </div>
    </ComposerTab>
  );
}

function UsageBody({
  provider,
  usage,
  reachable,
  now,
}: {
  provider: ProviderKind;
  usage: ProviderUsage | undefined;
  reachable: boolean;
  now: number;
}) {
  if (usage?.unavailable === 'no_api_key')
    return (
      <Note>
        Droid’s limits need a Factory API key, and DROIDEX has none. Droid’s own /limits shows them.
        <ManageUsageButton provider={provider} className="text-droid-text-secondary" />
      </Note>
    );
  if (usage?.unavailable === 'no_plan_limits')
    return <Note>{PROVIDER_LABELS[provider]} reports no plan limits for this account.</Note>;
  if (!usage)
    return (
      <Note>
        {reachable
          ? 'Checking usage…'
          : 'Usage can’t be read while the agent runtime is unavailable.'}
      </Note>
    );
  if (usage.meters.length === 0)
    return <Note>{usage.stale ? 'Couldn’t read usage.' : 'No limits reported.'}</Note>;
  return (
    <ul className="flex min-w-0 flex-col gap-2 px-1.5 pb-0.5 pt-0.5">
      {usage.meters.map((meter) => (
        <MeterRow key={meter.id} meter={meter} now={now} />
      ))}
    </ul>
  );
}

// Reset and pace wrap under the window's name on a narrow composer.
function MeterRow({ meter, now }: { meter: UsageMeter; now: number }) {
  const pace = usagePace(meter, now);
  const urgent = pace !== undefined && pace.kind !== 'lasts';
  const resetsIn =
    meter.resetsAt !== undefined && meter.resetsAt > now
      ? `Resets in ${formatDuration(meter.resetsAt - now)}`
      : undefined;
  return (
    <li className="flex min-w-0 flex-col gap-1">
      <div className="flex min-w-0 flex-wrap items-baseline justify-between gap-x-3 tabular-nums">
        <span className="flex min-w-0 items-baseline gap-1">
          <span className="truncate text-droid-text-secondary">{meterLabel(meter)}</span>
          <span className="shrink-0 text-droid-text-muted">·</span>
          <span className="shrink-0 text-droid-text">{usedLabel(meter.usedPercent)}</span>
        </span>
        <span className="flex min-w-0 items-baseline gap-1 text-droid-text-muted">
          {resetsIn && meter.resetsAt !== undefined && (
            <span title={`Resets ${formatResetTime(meter.resetsAt, now)}`}>{resetsIn}</span>
          )}
          {resetsIn && pace && <span>·</span>}
          {pace && (
            <span className={urgent ? 'text-droid-text-secondary' : ''}>{paceLabel(pace)}</span>
          )}
        </span>
      </div>
      <div
        role="meter"
        aria-label={meterLabel(meter)}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(meter.usedPercent)}
        className="h-1 w-full overflow-hidden rounded-full bg-droid-elevated"
      >
        <div
          className={`h-full rounded-full ${urgent ? 'bg-droid-orange' : 'bg-droid-text-secondary'}`}
          style={{ width: `${String(meter.usedPercent)}%` }}
        />
      </div>
    </li>
  );
}

function Note({ children }: { children: ReactNode }) {
  return (
    <div className="flex flex-wrap items-center gap-x-2 px-1.5 pb-0.5 text-droid-text-muted">
      {children}
    </div>
  );
}
