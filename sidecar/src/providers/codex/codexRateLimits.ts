// Codex's account rate limits: read when a session opens and kept current by
// the server's updates, so a refused turn can say which window ran out and
// when it resets (Codex's own turn error carries neither), and /usage can
// show every window of the account's main bucket.
import type { UsageLimit, UsageWindow } from '../../protocol.js';
import { numberValue, objectValue } from '../../values.js';
import type { ReportedMeter, UsageMetersListener, UsageReading } from '../session.js';
import { futureResetAt, resetAtMillis, UsageLimitError, windowUsage } from '../usageLimit.js';
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
  // Each read in flight gathers the updates that land meanwhile, which are
  // newer than its answer.
  private readonly reads = new Set<{ updates?: RateLimitSnapshot }>();
  // Reads can answer out of order; only the newest one started may replace
  // the snapshot.
  private readsStarted = 0;
  private newestApplied = 0;

  constructor(
    private readonly client: AppServerClient,
    private readonly onMeters?: UsageMetersListener,
  ) {}

  // A server that cannot answer (an older CLI, or a credential the backend
  // rejects) rejects the read and leaves the limits unknown. Reset credit
  // details are left out; their count still comes back.
  async read(signal?: AbortSignal): Promise<UsageReading> {
    const inFlight: { updates?: RateLimitSnapshot } = {};
    const sequence = ++this.readsStarted;
    this.reads.add(inFlight);
    let response: Record<string, unknown> | undefined;
    try {
      response = objectValue(
        await this.client.request<unknown>(
          'account/rateLimits/read',
          { excludeResetCreditDetails: true },
          signal,
        ),
      );
    } finally {
      this.reads.delete(inFlight);
    }
    const bucket = objectValue(objectValue(response?.rateLimitsByLimitId)?.[MAIN_BUCKET]);
    // A bucket that names neither window, or names one this build cannot read,
    // is malformed, not an account without limits.
    const read = bucket && wellFormed(bucket) ? snapshotOf(bucket) : undefined;
    if (!read) throw new Error('Codex answered without the codex rate limits.');
    if (sequence > this.newestApplied) {
      this.newestApplied = sequence;
      this.snapshot = inFlight.updates ? merged(read, inFlight.updates) : read;
    }
    // Free limit resets the account holds, shown only; nothing here spends one.
    const available = numberValue(objectValue(response?.rateLimitResetCredits)?.availableCount);
    return {
      meters: windowMeters(this.snapshot ?? read),
      ...(available === undefined
        ? {}
        : { extra: { kind: 'limit_resets', available: Math.max(0, Math.round(available)) } }),
    };
  }

  // `account/rateLimits/updated` carries one bucket, and a field it leaves
  // null keeps the value that bucket already had. Before any read has
  // answered, an update for the account's main bucket stands on its own.
  // Only the windows it carries are passed on.
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
    for (const inFlight of this.reads)
      inFlight.updates = inFlight.updates ? merged(inFlight.updates, update) : update;
    this.onMeters?.(windowMeters(update));
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

// Each window by its place in the snapshot, which is where the next update
// for it lands too.
function windowMeters(snapshot: RateLimitSnapshot): ReportedMeter[] {
  return (['primary', 'secondary'] as const).flatMap((id) => {
    const window = snapshot[id];
    if (!window) return [];
    const name = usageWindow(window);
    return [
      {
        id,
        ...(name ? { window: name } : {}),
        ...windowUsage(window.usedPercent, resetAtMillis(window.resetsAt)),
        ...(window.windowDurationMins ? { durationMs: window.windowDurationMins * 60_000 } : {}),
      },
    ];
  });
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

function wellFormed(bucket: Record<string, unknown>): boolean {
  const named = (['primary', 'secondary'] as const).filter((key) => key in bucket);
  return named.length > 0 && named.every((key) => bucket[key] === null || windowOf(bucket[key]));
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
