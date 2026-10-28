// Claude Code's own word on the account's allowance: read into the limit a
// refused turn carries, and into the meters /usage shows. `get_usage` reports
// every window at once (0-100, ISO resets); a `rate_limit_event` names one
// window (0-1, epoch-second reset) as its status changes.
import {
  USAGE_LIMIT_ERROR_PREFIXES,
  type Query,
  type SDKControlGetUsageResponse,
  type SDKMessage,
  type SDKRateLimitInfo,
} from '@anthropic-ai/claude-agent-sdk';

import type { UsageExtra, UsageLimit } from '../../protocol.js';
import type { ReportedMeter, UsageMetersListener, UsageReading } from '../session.js';
import { futureResetAt, resetAtMillis, UsageLimitError, windowUsage } from '../usageLimit.js';

const FIVE_HOURS_MS = 5 * 60 * 60_000;
const WEEK_MS = 7 * 24 * 60 * 60_000;

// Which window, and which one model family, a limit covers.
type LimitScope = Pick<UsageLimit, 'window' | 'model'>;

const RATE_LIMIT_SCOPES: Record<NonNullable<SDKRateLimitInfo['rateLimitType']>, LimitScope> = {
  five_hour: { window: 'five_hour' },
  seven_day: { window: 'weekly' },
  seven_day_opus: { window: 'weekly', model: 'Opus' },
  seven_day_sonnet: { window: 'weekly', model: 'Sonnet' },
  seven_day_overage_included: { window: 'weekly', model: 'Fable' },
  overage: {},
};

// The weekly quota for apps signed in to the account through OAuth, which only
// the usage read reports. It is named like a model so its row reads apart.
const OAUTH_APPS_SCOPE: LimitScope = { window: 'weekly', model: 'OAuth apps' };

// `rate_limit` also covers capacity refusals and model blocks. A usage refusal
// is worded as one of the CLI's own limits, or arrives while the allowance is
// spent: the CLI reports its allowance only when it changes, so the last
// report still describes the window a later refusal hit, until that window
// resets.
export function usageRefusal(
  text: string,
  lastRateLimit: SDKRateLimitInfo | undefined,
): UsageLimitError | undefined {
  const rejected = currentRejection(lastRateLimit);
  const spent =
    rejected !== undefined &&
    rejected.overageStatus !== 'allowed' &&
    rejected.overageStatus !== 'allowed_warning';
  if (!spent && !USAGE_LIMIT_ERROR_PREFIXES.some((prefix) => text.startsWith(prefix)))
    return undefined;
  return new UsageLimitError(text, refusedLimit(rejected));
}

// Only a rejected report describes the limit a refusal hit, and only until its
// window resets.
function currentRejection(info: SDKRateLimitInfo | undefined): SDKRateLimitInfo | undefined {
  if (info?.status !== 'rejected') return undefined;
  const resetsAt = resetAtMillis(rejectionResetSeconds(info));
  return resetsAt !== undefined && resetsAt <= Date.now() ? undefined : info;
}

function refusedLimit(info: SDKRateLimitInfo | undefined): UsageLimit {
  if (!info) return {};
  const resetsAt = futureResetAt(rejectionResetSeconds(info));
  return {
    ...(info.rateLimitType ? RATE_LIMIT_SCOPES[info.rateLimitType] : {}),
    ...(resetsAt === undefined ? {} : { resetsAt }),
  };
}

// Extra usage runs out on its own clock.
function rejectionResetSeconds(info: SDKRateLimitInfo): number | undefined {
  return info.rateLimitType === 'overage' ? info.overageResetsAt : info.resetsAt;
}

// A live session's account usage: read through its own query, and pushed as
// the CLI reports a window changing.
export class ClaudeUsage {
  constructor(
    private readonly query: Query,
    private readonly ready: () => Promise<void>,
    private readonly onMeters?: UsageMetersListener,
  ) {}

  // The SDK's usage call takes no signal, so a read it never answers stays
  // pending until the session closes.
  async read(signal: AbortSignal): Promise<UsageReading> {
    await this.ready();
    signal.throwIfAborted();
    return await readClaudeUsage(this.query);
  }

  observe(message: SDKMessage): void {
    if (message.type !== 'rate_limit_event') return;
    const meter = rateLimitMeter(message.rate_limit_info);
    if (meter) this.onMeters?.([meter]);
  }
}

// Plan limits only: `skipBehaviors` leaves out the scan of local transcripts.
export async function readClaudeUsage(query: Query): Promise<UsageReading> {
  const response = await query.usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET({
    skipBehaviors: true,
  });
  return claudeUsageReading(response);
}

type ClaudeWindow = { utilization: number | null; resets_at: string | null } | null | undefined;

function claudeUsageReading(response: SDKControlGetUsageResponse): UsageReading {
  if (!response.rate_limits_available) return { meters: [], unavailable: 'no_plan_limits' };
  const limits = response.rate_limits;
  if (!limits) throw new Error('Claude Code reported plan limits without their windows.');
  const general: [LimitScope, ClaudeWindow][] = [
    [RATE_LIMIT_SCOPES.five_hour, limits.five_hour],
    [RATE_LIMIT_SCOPES.seven_day, limits.seven_day],
    [OAUTH_APPS_SCOPE, limits.seven_day_oauth_apps],
    [RATE_LIMIT_SCOPES.seven_day_opus, limits.seven_day_opus],
    [RATE_LIMIT_SCOPES.seven_day_sonnet, limits.seven_day_sonnet],
  ];
  const modelScoped = (limits.model_scoped ?? []).map((scoped): [LimitScope, ClaudeWindow] => [
    { window: 'weekly', model: scoped.display_name },
    scoped,
  ]);
  // A model can be named both ways; its two rows share an id and the later stands.
  const meters = new Map<string, ReportedMeter>();
  for (const [scope, window] of [...general, ...modelScoped]) {
    if (typeof window?.utilization !== 'number') continue;
    const resetsAt = window.resets_at
      ? resetAtMillis(Date.parse(window.resets_at) / 1000)
      : undefined;
    const meter = claudeMeter(scope, window.utilization, resetsAt);
    meters.set(meter.id, meter);
  }
  if (meters.size === 0) throw new Error('Claude Code reported plan limits without any window.');
  const extra = extraUsage(limits.extra_usage);
  return {
    meters: [...meters.values()],
    ...(extra ? { extra } : {}),
    // The per-model windows are absent when nothing is known of them, as in
    // an answer from Claude Code's cache, which then speaks only for the
    // general windows: the per-model ones already known stay.
    ...(limits.model_scoped ? {} : { covers: general.map(([scope]) => meterId(scope)) }),
  };
}

function extraUsage(
  extra: { is_enabled: boolean; utilization: number | null } | null | undefined,
): UsageExtra | undefined {
  if (!extra?.is_enabled) return undefined;
  return {
    kind: 'extra_usage',
    ...(typeof extra.utilization === 'number' ? { usedPercent: percent(extra.utilization) } : {}),
  };
}

// The event's utilization is a share of 1, and extra usage is not a window.
function rateLimitMeter(info: SDKRateLimitInfo): ReportedMeter | undefined {
  const scope = info.rateLimitType ? RATE_LIMIT_SCOPES[info.rateLimitType] : undefined;
  if (!scope?.window || typeof info.utilization !== 'number') return undefined;
  return claudeMeter(scope, info.utilization * 100, resetAtMillis(info.resetsAt));
}

// The read and the event name a window the same way, so both land on one row.
function meterId({ window, model }: LimitScope): string {
  if (window === 'five_hour') return 'five_hour';
  return ['seven_day', model?.toLowerCase()].filter(Boolean).join('_');
}

function claudeMeter(
  scope: LimitScope,
  usedPercent: number,
  resetsAt: number | undefined,
): ReportedMeter {
  const { window, model } = scope;
  const fiveHour = window === 'five_hour';
  return {
    id: meterId(scope),
    ...(window ? { window } : {}),
    ...(model ? { model } : {}),
    ...windowUsage(usedPercent, resetsAt),
    durationMs: fiveHour ? FIVE_HOURS_MS : WEEK_MS,
  };
}

function percent(value: number): number {
  return Math.min(100, Math.max(0, value));
}
