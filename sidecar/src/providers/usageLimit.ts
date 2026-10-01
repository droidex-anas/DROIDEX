import type { UsageLimit } from '../protocol.js';

export class UsageLimitError extends Error {
  readonly errorKind = 'usage_limit' as const;

  constructor(
    message: string,
    readonly limit: UsageLimit = {},
  ) {
    super(message);
  }
}

// Only provider adapters classify failures; the turn runner carries their fields.
export function usageLimitDetails(error: unknown): {
  errorKind?: 'usage_limit';
  resetsAt?: number;
} {
  if (!(error instanceof UsageLimitError)) return {};
  const { resetsAt } = error.limit;
  return {
    errorKind: error.errorKind,
    ...(resetsAt === undefined ? {} : { resetsAt }),
  };
}

// Claude and Codex report reset timestamps in epoch seconds. The wire takes
// whole milliseconds only.
export function resetAtMillis(seconds: unknown): number | undefined {
  if (typeof seconds !== 'number' || !Number.isFinite(seconds) || seconds <= 0) return undefined;
  const millis = Math.round(seconds * 1000);
  return Number.isNaN(new Date(millis).getTime()) ? undefined : millis;
}

// A reset already behind us says nothing about when the limit lifts, and would
// release a held queue straight into another refusal.
export function futureResetAt(seconds: unknown): number | undefined {
  const millis = resetAtMillis(seconds);
  return millis !== undefined && millis > Date.now() ? millis : undefined;
}
