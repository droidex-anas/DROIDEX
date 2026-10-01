import type { UsageMeter } from '../../types/bridge';

// Early in a window the average rate is mostly its first burst, so no pace is
// read until this share of the window has passed.
const MIN_ELAPSED_SHARE = 0.05;

export type UsagePace =
  | { kind: 'reached' }
  | { kind: 'lasts' }
  | { kind: 'runs_out'; inMs: number };

// Where the window ends up if it keeps the average rate it has had since it
// opened: elapsed = length - time to reset. Unknown without a reset time and a
// length, and in the window's first moments.
export function usagePace(meter: UsageMeter, now: number): UsagePace | undefined {
  const { resetsAt, durationMs } = meter;
  // A window past its reset has emptied; its figure waits for the next read.
  if (resetsAt !== undefined && resetsAt <= now) return undefined;
  if (meter.usedPercent >= 100) return { kind: 'reached' };
  if (resetsAt === undefined || durationMs === undefined) return undefined;
  if (meter.usedPercent <= 0) return { kind: 'lasts' };
  const leftMs = resetsAt - now;
  const elapsedMs = durationMs - leftMs;
  if (elapsedMs < durationMs * MIN_ELAPSED_SHARE) return undefined;
  const inMs = ((100 - meter.usedPercent) / meter.usedPercent) * elapsedMs;
  return inMs < leftMs ? { kind: 'runs_out', inMs } : { kind: 'lasts' };
}

export interface PaceWarning {
  meter: UsageMeter;
  pace: Exclude<UsagePace, { kind: 'lasts' }>;
}

// The window that runs out soonest at its pace, for the warning above the
// composer. A spent window has run out already.
export function paceWarning(meters: readonly UsageMeter[], now: number): PaceWarning | undefined {
  let soonest: PaceWarning | undefined;
  for (const meter of meters) {
    const pace = usagePace(meter, now);
    if (!pace || pace.kind === 'lasts') continue;
    if (!soonest || runsOutIn(pace) < runsOutIn(soonest.pace)) soonest = { meter, pace };
  }
  return soonest;
}

function runsOutIn(pace: PaceWarning['pace']): number {
  return pace.kind === 'reached' ? 0 : pace.inMs;
}
