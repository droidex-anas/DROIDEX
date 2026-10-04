import assert from 'node:assert/strict';
import test from 'node:test';

import {
  CONTEXT_POLL_ACTIVE_MS,
  CONTEXT_POLL_BACKGROUND_MS,
  CONTEXT_POLL_INACTIVE_MS,
  ContextPollHost,
  contextPollIntervalMs,
} from './contextPollScheduler.js';

test('cadence follows whether the chat is on screen and its role, and hidden or low-power tiers pause polling', () => {
  const cases: [string, Parameters<typeof contextPollIntervalMs>[0], number][] = [
    [
      'on-screen primary',
      { tier: 'interactive', isChild: false, isOnScreen: true },
      CONTEXT_POLL_ACTIVE_MS,
    ],
    [
      'child of an on-screen chat',
      { tier: 'interactive', isChild: true, isOnScreen: true },
      CONTEXT_POLL_BACKGROUND_MS,
    ],
    [
      'off-screen primary',
      { tier: 'interactive', isChild: false, isOnScreen: false },
      CONTEXT_POLL_INACTIVE_MS,
    ],
    [
      'child of an off-screen chat',
      { tier: 'interactive', isChild: true, isOnScreen: false },
      CONTEXT_POLL_INACTIVE_MS,
    ],
    ['hidden', { tier: 'hidden', isChild: false, isOnScreen: true }, 0],
    ['low-power', { tier: 'low-power', isChild: true, isOnScreen: true }, 0],
  ];
  for (const [label, input, expected] of cases) {
    assert.equal(contextPollIntervalMs(input), expected, label);
  }
});

test('poll host pauses timers when cadence drops to zero and resumes with an immediate poll', () => {
  const polls: string[] = [];
  const timers = new Map<number, { callback: () => void; ms: number }>();
  let nextId = 1;
  let cadence = 2_500;
  const host = new ContextPollHost<{ session: object; appSessionId: string }>({
    setIntervalFn: ((callback: () => void, ms: number) => {
      const id = nextId;
      nextId += 1;
      timers.set(id, { callback, ms });
      return id as unknown as ReturnType<typeof setInterval>;
    }) as typeof setInterval,
    clearIntervalFn: ((id: ReturnType<typeof setInterval>) => {
      timers.delete(id as unknown as number);
    }) as typeof clearInterval,
    cadenceFor: () => cadence,
    poll: (target) => {
      polls.push(target.appSessionId);
    },
  });

  const target = { session: {}, appSessionId: 'app-1' };
  host.start('primary:app-1', target);
  assert.deepEqual(polls, ['app-1']);
  assert.equal(host.counts().active, 1);
  assert.equal([...timers.values()][0]?.ms, 2_500);

  cadence = 0;
  host.reschedule();
  assert.equal(host.counts().active, 0);
  assert.equal(timers.size, 0);

  cadence = 10_000;
  host.reschedule();
  assert.deepEqual(polls, ['app-1', 'app-1']);
  assert.equal(host.counts().active, 1);
  assert.equal([...timers.values()][0]?.ms, 10_000);

  host.clearAll();
  assert.equal(host.counts().total, 0);
  assert.equal(timers.size, 0);
});
