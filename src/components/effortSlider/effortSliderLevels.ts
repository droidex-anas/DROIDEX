/**
 * Level vocabulary for the effort slider: the default stops, the ultra
 * predicate, and value parsing. Kept apart from the element so the list
 * semantics (a model publishes its own stops) have one home.
 */

export interface EffortSliderLevel {
  value: string;
  label: string;
}

export const DEFAULT_LEVELS: readonly EffortSliderLevel[] = Object.freeze(
  (
    [
      ['low', 'Low'],
      ['medium', 'Medium'],
      ['high', 'High'],
      ['xhigh', 'Extra'],
      ['max', 'Max'],
      ['ultra', 'Ultracode'],
    ] as const
  ).map(([value, label]) => Object.freeze({ value, label })),
);

/** The Ultracode treatment keys on the value, not the last stop. */
export const isUltraLevel = (level: EffortSliderLevel | undefined): boolean =>
  level?.value === 'ultra';

/** Resolve a named level or zero-based index to an index; throws on anything else. */
export function parseEffortValue(
  levels: readonly EffortSliderLevel[],
  value: string | number,
): number {
  const last = levels.length - 1;
  if (typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= last) {
    return value;
  }
  if (typeof value === 'string') {
    const index = levels.findIndex((level) => level.value === value.toLowerCase());
    if (index !== -1) return index;
  }
  throw new RangeError(
    `Effort must be an integer from 0 to ${String(last)}, or: ${levels.map((x) => x.value).join(', ')}.`,
  );
}

const KEY_STEPS: Record<string, number> = {
  ArrowRight: 1,
  ArrowUp: 1,
  ArrowLeft: -1,
  ArrowDown: -1,
  PageUp: 2,
  PageDown: -2,
};

/** The level index a navigation key targets, or undefined for keys the slider ignores. */
export function effortIndexFromKey(key: string, index: number, last: number): number | undefined {
  if (key === 'Home') return 0;
  if (key === 'End') return last;
  if (!(key in KEY_STEPS)) return undefined;
  return Math.min(last, Math.max(0, index + KEY_STEPS[key]));
}
