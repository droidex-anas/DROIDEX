import type { UsageTokenCounts } from './types.js';

const MAX_TOKEN_COUNT = 1_000_000_000_000_000;
export const COUNT_KEYS = [
  'inputTokens',
  'outputTokens',
  'cacheWriteTokens',
  'cacheReadTokens',
  'reasoningTokens',
] as const satisfies readonly (keyof UsageTokenCounts)[];

const EMPTY_COUNTS: UsageTokenCounts = {
  inputTokens: null,
  outputTokens: null,
  cacheWriteTokens: null,
  cacheReadTokens: null,
  reasoningTokens: null,
};

export function count(value: unknown): number | null {
  return Number.isSafeInteger(value) && Number(value) >= 0 && Number(value) <= MAX_TOKEN_COUNT
    ? Number(value)
    : null;
}

export function completeSum(...values: (number | null)[]): number | null {
  if (values.some((value) => value === null)) return null;
  const total = values.reduce<number>((sum, value) => sum + (value ?? 0), 0);
  return Number.isSafeInteger(total) && total <= MAX_TOKEN_COUNT ? total : null;
}

export function codexCounts(value: Record<string, unknown>): UsageTokenCounts {
  return {
    inputTokens: count(value.input_tokens ?? value.inputTokens),
    outputTokens: count(value.output_tokens ?? value.outputTokens),
    cacheWriteTokens: count(
      value.cache_creation_input_tokens ??
        value.cacheCreationInputTokens ??
        value.cache_write_tokens ??
        value.cache_write_input_tokens,
    ),
    cacheReadTokens: count(
      value.cached_input_tokens ?? value.cachedInputTokens ?? value.cache_read_input_tokens,
    ),
    reasoningTokens: count(value.reasoning_output_tokens ?? value.reasoningOutputTokens),
  };
}

export function codexUsageCounts(
  usage: Record<string, unknown> | null,
  total: UsageTokenCounts | null,
  previous: UsageTokenCounts | null,
): UsageTokenCounts | null {
  if (sameKnownCounts(total, previous)) return null;
  if (usage) return codexCounts(usage);
  return cumulativeDelta(total, previous);
}

function cumulativeDelta(
  current: UsageTokenCounts | null,
  previous: UsageTokenCounts | null,
): UsageTokenCounts | null {
  if (!current) return null;
  if (!previous) return current;
  const delta = { ...EMPTY_COUNTS };
  for (const key of COUNT_KEYS) {
    const next = current[key];
    const before = previous[key];
    if (next === null) delta[key] = null;
    else if (before === null) delta[key] = next;
    else delta[key] = Math.max(0, next - before);
  }
  return COUNT_KEYS.every((key) => delta[key] === null || delta[key] === 0) ? null : delta;
}

export function mergeKnownCounts(
  previous: UsageTokenCounts | null,
  current: UsageTokenCounts | null,
): UsageTokenCounts | null {
  if (!current) return previous;
  const merged = { ...EMPTY_COUNTS };
  for (const key of COUNT_KEYS) merged[key] = current[key] ?? previous?.[key] ?? null;
  return merged;
}

export function sameKnownCounts(
  current: UsageTokenCounts | null,
  previous: UsageTokenCounts | null,
): boolean {
  if (!current || !previous) return false;
  let compared = false;
  for (const key of COUNT_KEYS) {
    if (current[key] === null || previous[key] === null) continue;
    compared = true;
    if (current[key] !== previous[key]) return false;
  }
  return compared;
}
