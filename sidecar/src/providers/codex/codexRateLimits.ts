// Codex's account rate limits: read when a session opens and kept current by
// the server's updates, so a refused turn can say which window ran out and
// when it resets (Codex's own turn error carries neither), and /usage can
// show every window of the account's main bucket.
import type { UsageLimit, UsageMeter, UsageWindow } from '../../protocol.js';
import { numberValue, objectValue } from '../../values.js';
import type { UsageMetersListener, UsageReading } from '../session.js';
import { futureResetAt, UsageLimitError } from '../usageLimit.js';
import type { AppServerClient } from './appServer.js';

// The bucket every Codex model draws on. Others (a model's own, such as
// Spark's) are left out so they can never stand in for it.
const MAIN_BUCKET = 'codex';

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

  constructor(
    private readonly client: AppServerClient,
    private readonly onMeters?: UsageMetersListener,
  ) {}

  // A server that cannot answer (an older CLI, or a credential the backend
  // rejects) rejects the read and leaves the limits unknown. Reset credit
  // details are left out; their count still comes back.
  async read(): Promise<UsageReading> {
    const response = objectValue(
      await this.client.request<unknown>('account/rateLimits/read', {
        excludeResetCreditDetails: true,
      }),
    );
    const read = snapshotOf(objectValue(response?.rateLimitsByLimitId)?.[MAIN_BUCKET]);
    if (!read) throw new Error('Codex answered without the codex rate limits.');
    // An update that landed while this read was in flight is newer.
    const current = this.snapshot;
    this.snapshot = current && current.limitId === read.limitId ? merged(read, current) : read;
    // Free limit resets the account holds, shown only; nothing here spends one.
    const available = numberValue(objectValue(response?.rateLimitResetCredits)?.availableCount);
    return {
      meters: this.meters(),
      ...(available === undefined
        ? {}
        : { extra: { kind: 'limit_resets', available: Math.max(0, Math.round(available)) } }),
    };
  }

  // `account/rateLimits/updated` carries one bucket, and a field it leaves
  // null keeps the value that bucket already had. Before any read has
  // answered, an update for the account's main bucket stands on its own.
  update(params: unknown): void {
    const update = snapshotOf(objectValue(params)?.rateLimits);
    if (!update) return;
    const current = this.snapshot;
    if (current) {
      if (update.limitId !== current.limitId) return;
      this.snapshot = merged(current, update);
    } else {
      if (update.limitId !== undefined && update.limitId !== MAIN_BUCKET) return;
      this.snapshot = update;
    }
    this.onMeters?.(this.meters());
  }

  usageLimitError(message: string): UsageLimitError {
    return new UsageLimitError(message, this.reachedLimit());
  }

  // Each window by its place in the snapshot, which is where the next update
  // for it lands too.
  private meters(): UsageMeter[] {
    const snapshot = this.snapshot;
    if (!snapshot) return [];
    return (['primary', 'secondary'] as const).flatMap((id) => {
      const window = snapshot[id];
      if (!window) return [];
      const name = usageWindow(window);
      const resetsAt = futureResetAt(window.resetsAt);
      return [
        {
          id,
          ...(name ? { window: name } : {}),
          usedPercent: Math.min(100, Math.max(0, window.usedPercent)),
          ...(resetsAt === undefined ? {} : { resetsAt }),
          ...(window.windowDurationMins ? { durationMs: window.windowDurationMins * 60_000 } : {}),
        },
      ];
    });
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

function merged(older: RateLimitSnapshot, newer: RateLimitSnapshot): RateLimitSnapshot {
  return {
    limitId: older.limitId,
    primary: newer.primary ?? older.primary,
    secondary: newer.secondary ?? older.secondary,
    individualLimitResetsAt: newer.individualLimitResetsAt ?? older.individualLimitResetsAt,
    spendControlReached: newer.spendControlReached ?? older.spendControlReached,
  };
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
