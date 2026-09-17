export class UsageLimitError extends Error {
  readonly errorKind = 'usage_limit' as const;

  constructor(
    message: string,
    readonly resetsAt?: number,
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
  return {
    errorKind: error.errorKind,
    ...(error.resetsAt === undefined ? {} : { resetsAt: error.resetsAt }),
  };
}

// Claude and Codex image failures report reset timestamps in epoch seconds.
export function resetAtMillis(seconds: unknown): number | undefined {
  if (typeof seconds !== 'number' || !Number.isFinite(seconds) || seconds <= 0) return undefined;
  const millis = seconds * 1000;
  return Number.isNaN(new Date(millis).getTime()) ? undefined : millis;
}
