import test from 'node:test';
import assert from 'node:assert/strict';
import type { ProviderUsage, UsageMeter } from '../protocol.js';
import { AccountUsage } from './accountUsage.js';
import type { UsageReading } from './session.js';

const fiveHour: UsageMeter = { id: 'five_hour', window: 'five_hour', usedPercent: 20 };
const weekly: UsageMeter = { id: 'seven_day', window: 'weekly', usedPercent: 40 };

test('a push replaces only its own window, and a failed read keeps the last good ones', async () => {
  let reads = 0;
  let answer = (): Promise<UsageReading> => Promise.resolve({ meters: [fiveHour, weekly] });
  let clock = 1_000_000;
  const emitted: ProviderUsage[] = [];
  const usage = new AccountUsage(
    {
      liveSession: () => ({
        usage: {
          read: () => {
            reads += 1;
            return answer();
          },
        },
      }),
      readWithoutSession: () => Promise.reject(new Error('a live session reads instead')),
      emit: (event) => {
        if (event.type === 'usage.updated') emitted.push(event.usage);
      },
    },
    () => clock,
  );

  await usage.refresh('claude', { panelOpen: false, immediate: false });
  usage.pushed('claude', [{ ...fiveHour, usedPercent: 35 }]);
  // A turn ending moments later keeps the answer it already has.
  usage.afterTurn('claude');
  answer = () => Promise.reject(new Error('get_usage changed shape'));
  clock += 61_000;
  await usage.refresh('claude', { panelOpen: false, immediate: false });
  usage.close();

  assert.equal(reads, 2);
  assert.deepEqual(
    emitted.map((entry) => [
      entry.meters.map((meter) => `${meter.id} ${String(meter.usedPercent)}`),
      entry.stale === true,
    ]),
    [
      [['five_hour 20', 'seven_day 40'], false],
      [['five_hour 35', 'seven_day 40'], false],
      [['five_hour 35', 'seven_day 40'], true],
    ],
  );
});
