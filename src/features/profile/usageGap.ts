import type { RemoteUsageSnapshot, UsageTotalField } from '../../../packages/remote/src/usage';

// A total is labelled a minimum (≥) only when more than this share of events
// did not report it. A smaller gap is named in Usage details instead, so a
// handful of unreported entries does not qualify a total of billions.
export const MATERIAL_GAP_SHARE = 0.01;

export interface UsageGap {
  missingEvents: number;
  events: number;
  isMaterial: boolean;
}

type GapSource = Pick<RemoteUsageSnapshot, 'coverage' | 'totals'>;

function gap(missingEvents: number, events: number): UsageGap {
  return {
    missingEvents,
    events,
    isMaterial: events > 0 && missingEvents / events > MATERIAL_GAP_SHARE,
  };
}

export function fieldGap(usage: GapSource, field: UsageTotalField): UsageGap {
  const coverage = Object.hasOwn(usage.coverage, field) ? usage.coverage[field] : undefined;
  if (!coverage) return gap(0, usage.totals.events);
  return gap(coverage.events - coverage.known, coverage.events);
}

// Token totals are input + output, matching the ledger's `tokensComplete`.
// The larger of the two gaps is a lower bound on events missing either.
export function tokenGap(usage: GapSource): UsageGap {
  const input = fieldGap(usage, 'inputTokens');
  const output = fieldGap(usage, 'outputTokens');
  return gap(Math.max(input.missingEvents, output.missingEvents), usage.totals.events);
}
