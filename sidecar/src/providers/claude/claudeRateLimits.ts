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
import { futureResetAt, UsageLimitError } from '../usageLimit.js';

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

// `rate_limit` also covers capacity refusals and model blocks. A usage refusal
// is worded as one of the CLI's own limits, or arrives while the allowance is
// spent: the CLI reports its allowance only when it changes, so the last
// report still describes the window a later refusal hit.
export function usageRefusal(
  text: string,
  lastRateLimit: SDKRateLimitInfo | undefined,
): UsageLimitError | undefined {
  const spent =
    lastRateLimit?.status === 'rejected' &&
    lastRateLimit.overageStatus !== 'allowed' &&
    lastRateLimit.overageStatus !== 'allowed_warning';
  if (!spent && !USAGE_LIMIT_ERROR_PREFIXES.some((prefix) => text.startsWith(prefix)))
    return undefined;
  return new UsageLimitError(text, refusedLimit(lastRateLimit));
}

// Only a rejected report describes the limit a refusal hit. Extra usage runs
// out on its own clock.
function refusedLimit(info: SDKRateLimitInfo | undefined): UsageLimit {
  if (info?.status !== 'rejected') return {};
  const resetsAt = futureResetAt(
    info.rateLimitType === 'overage' ? info.overageResetsAt : info.resetsAt,
  );
  return {
    ...(info.rateLimitType ? RATE_LIMIT_SCOPES[info.rateLimitType] : {}),
    ...(resetsAt === undefined ? {} : { resetsAt }),
  };
}

// A live session's account usage: read through its own query, and pushed as
// the CLI reports a window changing. The read is experimental in the SDK, so a
// failure only leaves the last good meters standing.
export class ClaudeUsage {
  constructor(
    private readonly query: Query,
    private readonly ready: () => Promise<void>,
    private readonly onMeters?: UsageMetersListener,
  ) {}

  async read(): Promise<UsageReading> {
    await this.ready();
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
  const windows: [LimitScope, ClaudeWindow][] = [
    [RATE_LIMIT_SCOPES.five_hour, limits.five_hour],
    [RATE_LIMIT_SCOPES.seven_day, limits.seven_day],
    [RATE_LIMIT_SCOPES.seven_day_opus, limits.seven_day_opus],
    [RATE_LIMIT_SCOPES.seven_day_sonnet, limits.seven_day_sonnet],
    ...(limits.model_scoped ?? []).map((scoped): [LimitScope, ClaudeWindow] => [
      { window: 'weekly', model: scoped.display_name },
      scoped,
    ]),
  ];
  // A model can be named both ways; its two rows share an id and the later stands.
  const meters = new Map<string, ReportedMeter>();
  for (const [scope, window] of windows) {
    if (typeof window?.utilization !== 'number') continue;
    const resetsAt = window.resets_at
      ? futureResetAt(Date.parse(window.resets_at) / 1000)
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
    // an answer from Claude Code's cache, so the ones already known stay.
    ...(limits.model_scoped ? {} : { partial: true }),
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
  return claudeMeter(scope, info.utilization * 100, futureResetAt(info.resetsAt));
}

// The read and the event name a window the same way, so both land on one row.
function claudeMeter(
  { window, model }: LimitScope,
  usedPercent: number,
  resetsAt: number | undefined,
): ReportedMeter {
  const fiveHour = window === 'five_hour';
  const id = fiveHour ? 'five_hour' : ['seven_day', model?.toLowerCase()].filter(Boolean).join('_');
  return {
    id,
    ...(window ? { window } : {}),
    ...(model ? { model } : {}),
    usedPercent: percent(usedPercent),
    ...(resetsAt === undefined ? {} : { resetsAt }),
    durationMs: fiveHour ? FIVE_HOURS_MS : WEEK_MS,
  };
}

function percent(value: number): number {
  return Math.min(100, Math.max(0, value));
}
