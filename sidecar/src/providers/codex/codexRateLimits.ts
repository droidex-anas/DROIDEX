// Codex's account rate limits: read once when a session opens and kept current
// by the server's updates, so a refused turn can say which window ran out and
// when it resets. Codex's own turn error carries neither.
import type { UsageLimit, UsageWindow } from '../../protocol.js';
import { numberValue, objectValue } from '../../values.js';
import { futureResetAt, UsageLimitError } from '../usageLimit.js';
import type { AppServerClient } from './appServer.js';

interface RateLimitWindow {
  usedPercent: number;
  windowDurationMins: number | undefined;
  resetsAt: number | undefined;
}

interface RateLimitSnapshot {
  limitId: string | undefined;
  primary: RateLimitWindow | undefined;
  secondary: RateLimitWindow | undefined;
  individualLimitResetsAt: number | undefined;
  spendControlReached: boolean | undefined;
}

export class CodexRateLimits {
  private snapshot?: RateLimitSnapshot;

  // Never awaited by the open. A server that cannot answer (an older CLI, or a
  // credential the backend rejects) leaves the limits unknown. Reset credit
  // details are left out: nothing here spends one.
  read(client: AppServerClient): void {
    void client
      .request<unknown>('account/rateLimits/read', { excludeResetCreditDetails: true })
      .then((response) => {
        const snapshot = snapshotOf(objectValue(response)?.rateLimits);
        if (snapshot) this.snapshot = snapshot;
      })
      .catch(() => undefined);
  }

  // `account/rateLimits/updated` carries one bucket, and a field it leaves
  // null keeps the value that bucket already had.
  update(params: unknown): void {
    const update = snapshotOf(objectValue(params)?.rateLimits);
    const current = this.snapshot;
    if (!update || !current || update.limitId !== current.limitId) return;
    this.snapshot = {
      limitId: current.limitId,
      primary: update.primary ?? current.primary,
      secondary: update.secondary ?? current.secondary,
      individualLimitResetsAt: update.individualLimitResetsAt ?? current.individualLimitResetsAt,
      spendControlReached: update.spendControlReached ?? current.spendControlReached,
    };
  }

  usageLimitError(message: string): UsageLimitError {
    return new UsageLimitError(message, this.reachedLimit());
  }

  // The spent window that resets last, else the spend control that stopped the
  // account. Codex also refuses with nothing spent, and then no window is to blame.
  private reachedLimit(): UsageLimit {
    const snapshot = this.snapshot;
    if (!snapshot) return {};
    const spent = [snapshot.primary, snapshot.secondary].flatMap((window) => {
      if (!window || window.usedPercent < 100) return [];
      const resetsAt = futureResetAt(window.resetsAt);
      return resetsAt === undefined ? [] : [{ resetsAt, name: usageWindow(window) }];
    });
    const last = spent.sort((left, right) => right.resetsAt - left.resetsAt).at(0);
    if (last) return { ...(last.name ? { window: last.name } : {}), resetsAt: last.resetsAt };
    const resetsAt = snapshot.spendControlReached
      ? futureResetAt(snapshot.individualLimitResetsAt)
      : undefined;
    return resetsAt === undefined ? {} : { resetsAt };
  }
}

function usageWindow({ windowDurationMins: minutes }: RateLimitWindow): UsageWindow | undefined {
  if (minutes === 300) return 'five_hour';
  if (minutes === 1440) return 'daily';
  if (minutes === 10080) return 'weekly';
  if (minutes !== undefined && minutes >= 40320 && minutes <= 44640) return 'monthly';
  return undefined;
}

// The payload is untrusted: a field this build does not recognize reads as unknown.
function snapshotOf(value: unknown): RateLimitSnapshot | undefined {
  const snapshot = objectValue(value);
  if (!snapshot) return undefined;
  const { limitId, spendControlReached } = snapshot;
  return {
    limitId: typeof limitId === 'string' ? limitId : undefined,
    primary: windowOf(snapshot.primary),
    secondary: windowOf(snapshot.secondary),
    individualLimitResetsAt: numberValue(objectValue(snapshot.individualLimit)?.resetsAt),
    spendControlReached: typeof spendControlReached === 'boolean' ? spendControlReached : undefined,
  };
}

function windowOf(value: unknown): RateLimitWindow | undefined {
  const window = objectValue(value);
  const usedPercent = numberValue(window?.usedPercent);
  if (usedPercent === undefined) return undefined;
  return {
    usedPercent,
    windowDurationMins: numberValue(window?.windowDurationMins),
    resetsAt: numberValue(window?.resetsAt),
  };
}
