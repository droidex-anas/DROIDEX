import assert from 'node:assert/strict';
import test from 'node:test';
import type { UsageMeter } from '../../types/bridge';
import { paceWarning, usagePace } from './usagePace';

const HOUR = 60 * 60_000;
const NOW = Date.UTC(2026, 9, 1, 12);

// A 5-hour window `elapsedHours` along, with `usedPercent` spent.
function fiveHour(usedPercent: number, elapsedHours: number): UsageMeter {
  return {
    id: 'five_hour',
    window: 'five_hour',
    usedPercent,
    durationMs: 5 * HOUR,
    resetsAt: NOW + (5 - elapsedHours) * HOUR,
  };
}

test('pace projects the average rate since the window opened to its reset', () => {
  // 40% in 2h runs at 20%/h: the last 60% takes 3h, exactly the time left.
  assert.deepEqual(usagePace(fiveHour(40, 2), NOW), { kind: 'lasts' });
  // 60% in 2h runs at 30%/h: the last 40% is gone in 80 minutes, before the reset.
  const fast = usagePace(fiveHour(60, 2), NOW);
  assert.equal(fast?.kind === 'runs_out' && Math.round(fast.inMs / 60_000), 80);
  assert.deepEqual(usagePace(fiveHour(100, 2), NOW), { kind: 'reached' });
  // A burst in the window's first minute is measured against 5% of it, not the minute.
  const burst = usagePace(fiveHour(10, 1 / 60), NOW);
  assert.deepEqual(burst, { kind: 'runs_out', inMs: 9 * 0.25 * HOUR });
  // Without a reset time, or past it, nothing is known.
  assert.equal(usagePace({ ...fiveHour(60, 2), resetsAt: undefined }, NOW), undefined);
  assert.equal(usagePace({ ...fiveHour(100, 2), resetsAt: NOW - 1 }, NOW), undefined);
});

test('the warning names the window that runs out first, once half of it is used', () => {
  const weekly: UsageMeter = {
    id: 'seven_day',
    window: 'weekly',
    usedPercent: 90,
    durationMs: 168 * HOUR,
    resetsAt: NOW + 84 * HOUR,
  };
  // The weekly runs out in about 9h; the 5-hour one in 80 minutes.
  assert.equal(paceWarning([weekly, fiveHour(60, 2)], NOW)?.meter.id, 'five_hour');
  // Under half used, a fast start is not yet a warning.
  assert.equal(paceWarning([fiveHour(45, 1)], NOW), undefined);
});
