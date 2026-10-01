// Claude Code's own word on the account's allowance, read into the limit a
// refused turn carries.
import { USAGE_LIMIT_ERROR_PREFIXES, type SDKRateLimitInfo } from '@anthropic-ai/claude-agent-sdk';

import type { UsageLimit } from '../../protocol.js';
import { futureResetAt, UsageLimitError } from '../usageLimit.js';

const RATE_LIMIT_SCOPES: Record<
  NonNullable<SDKRateLimitInfo['rateLimitType']>,
  Pick<UsageLimit, 'window' | 'model'>
> = {
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
