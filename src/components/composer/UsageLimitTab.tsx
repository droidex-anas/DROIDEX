import { Fragment } from 'react';
import { ExternalLink, Gauge } from '@droidex/icons';
import { PROVIDER_USAGE_URLS } from '../../features/providers/providerIdentity';
import { formatDuration, limitName } from '../../features/usage/usageCopy';
import type { PaceWarning } from '../../features/usage/usagePace';
import { openExternal } from '../../lib/onboarding';
import { formatResetTime, limitLabel, resetLabel } from '../../lib/usageLimit';
import type { ProviderKind, UsageLimit } from '../../types/bridge';
import { ComposerTab } from './ComposerTab';

// StartInBar's pill. Each action adds its color: the one that can unblock the
// chat reads brightest.
export const ACTION_CLASS =
  'group flex items-center gap-1.5 rounded-md px-1.5 py-1 text-[11px] transition-colors hover:bg-droid-bg/40 hover:text-droid-text focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-droid-accent/60';

// The tab above the composer while the chat is held on a usage limit, in
// StartInBar's slot and shape. It never blocks the composer: a message sent now
// still reaches the harness, which checks the limit again. On a narrow composer
// the actions wrap to a second row, so the headline always reads in full.
export function UsageLimitTab({
  limit,
  provider,
  onSwitchModel,
}: {
  limit: UsageLimit;
  provider: ProviderKind;
  onSwitchModel: () => void;
}) {
  const headline = limitLabel(limit);
  const detail = resetLabel(limit.resetsAt, Date.now());

  return (
    <ComposerTab>
      <div className="flex min-w-0 flex-wrap items-center gap-x-4 overflow-hidden">
        <div
          role="status"
          aria-live="polite"
          title={`${headline} · ${detail}`}
          className="flex min-w-0 flex-auto items-center gap-1.5 px-1.5 py-1 text-[11px]"
        >
          <span className="shrink-0 text-droid-orange">
            <Gauge className="h-3.5 w-3.5" strokeWidth={2} />
          </span>
          <span className="flex min-w-0 items-center gap-1 tabular-nums">
            <span className="shrink-0 font-medium text-droid-text">{headline}</span>
            <span className="shrink-0 text-droid-text-muted">·</span>
            <span className="min-w-0 truncate text-droid-text-muted">{detail}</span>
          </span>
        </div>
        <div className="ml-auto flex shrink-0 items-center gap-1">
          {limit.model && (
            <button
              type="button"
              onClick={onSwitchModel}
              className={`${ACTION_CLASS} text-droid-text`}
            >
              Switch model
            </button>
          )}
          <ManageUsageButton provider={provider} className="text-droid-text-secondary" />
        </div>
      </div>
    </ComposerTab>
  );
}

// The quieter line before a limit: the window that runs out soonest at its
// pace, one step dimmer than the reached tab throughout.
export function UsageWarningTab({
  warning: { meter, pace },
  provider,
  now,
}: {
  warning: PaceWarning;
  provider: ProviderKind;
  now: number;
}) {
  const headline = `${String(Math.round(meter.usedPercent))}% of your ${limitName(meter)} limit used`;
  const details = [
    meter.resetsAt === undefined ? undefined : `Resets ${formatResetTime(meter.resetsAt, now)}`,
    pace.kind === 'reached' ? 'limit reached' : `runs out in ${formatDuration(pace.inMs)}`,
  ].filter((part) => part !== undefined);

  return (
    <ComposerTab>
      <div className="flex min-w-0 flex-wrap items-center gap-x-4 overflow-hidden">
        <div
          role="status"
          aria-live="polite"
          title={[headline, ...details].join(' · ')}
          className="flex min-w-0 flex-auto items-center gap-1.5 px-1.5 py-1 text-[11px]"
        >
          <span className="shrink-0 text-droid-text-muted">
            <Gauge className="h-3.5 w-3.5" strokeWidth={2} />
          </span>
          {/* Flows as text: on a narrow composer it wraps between details, so
              neither the headline nor a time is ever cut short. */}
          <span className="min-w-0 tabular-nums">
            <span className="text-droid-text-secondary">{headline}</span>
            {details.map((detail) => (
              <Fragment key={detail}>
                {' '}
                <span className="whitespace-nowrap text-droid-text-muted">· {detail}</span>
              </Fragment>
            ))}
          </span>
        </div>
        <div className="ml-auto flex shrink-0 items-center gap-1">
          <ManageUsageButton provider={provider} className="text-droid-text-muted" />
        </div>
      </div>
    </ComposerTab>
  );
}

// Opens the harness's own usage page in the browser.
export function ManageUsageButton({
  provider,
  className,
}: {
  provider: ProviderKind;
  className: string;
}) {
  return (
    <button
      type="button"
      onClick={() => void openExternal(PROVIDER_USAGE_URLS[provider])}
      className={`${ACTION_CLASS} ${className}`}
    >
      Manage usage
      <ExternalLink
        className="h-3 w-3 shrink-0 text-droid-text-muted transition-colors group-hover:text-droid-text-secondary"
        strokeWidth={2}
      />
    </button>
  );
}
