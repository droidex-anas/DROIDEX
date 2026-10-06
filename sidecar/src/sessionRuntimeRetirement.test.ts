import assert from 'node:assert/strict';
import test from 'node:test';

import type { LiveSession } from './SessionLifecycle.js';
import {
  nextSessionRetirementAt,
  retirableSessions,
  SessionRuntimeRetirement,
  type SessionRetirementFacts,
  type SessionRuntimeRetirementDependencies,
} from './sessionRuntimeRetirement.js';
import { fakeProviderSession, FakeFactorySession } from './testing/fakeFactoryRuntime.js';
import { sessionSummary } from './testing/sessionSummaryFixture.js';

const IDLE_MS = 1_800_000;

function facts(
  appSessionId: string,
  idleSince: number,
  patch: Partial<SessionRetirementFacts> = {},
): SessionRetirementFacts {
  return {
    appSessionId,
    idleSince,
    phase: 'paused',
    streaming: false,
    compacting: false,
    queuedSends: 0,
    interrupting: false,
    closing: false,
    coolingDown: false,
    onScreen: false,
    hasUnsettledChildren: false,
    hasOpenBrowser: false,
    hasPendingSettings: false,
    hasAgentProcesses: false,
    hasLiveVoice: false,
    ...patch,
  };
}

test('a settled background session is retirable once it passes the idle budget, oldest deadline first', () => {
  const idle = [facts('a', 1_000)];

  assert.deepEqual(retirableSessions(idle, 1_000 + IDLE_MS - 1, IDLE_MS), []);
  assert.deepEqual(retirableSessions(idle, 1_000 + IDLE_MS, IDLE_MS), ['a']);

  // A monotonic timestamp ahead of the clock counts as zero elapsed idle time.
  const ahead = [facts('a', 101)];
  assert.deepEqual(retirableSessions(ahead, 100, 0), ['a']);
  assert.deepEqual(retirableSessions(ahead, 100, 1), []);
  assert.deepEqual(retirableSessions(ahead, 102, 1), ['a']);

  // The next deadline follows the session that went idle first.
  const two = [facts('older', 1_000), facts('newer', 4_000)];
  assert.equal(nextSessionRetirementAt(two, 10_000, IDLE_MS), 1_000 + IDLE_MS);
  assert.equal(
    nextSessionRetirementAt([facts('busy', 1_000, { streaming: true })], 10_000, IDLE_MS),
    undefined,
  );
  assert.equal(nextSessionRetirementAt([], 10_000, IDLE_MS), undefined);
});

test('a session on screen, with work, unsaved intent, or a resource in use is never retirable', () => {
  const forever = 1_000 + IDLE_MS * 100;
  const blocked: [string, Partial<SessionRetirementFacts>][] = [
    ['on-screen', { onScreen: true }],
    ['mid-turn', { streaming: true }],
    ['mid-mission-turn', { phase: 'orchestrator_turn', streaming: true }],
    ['still-initializing', { phase: 'initializing' }],
    ['awaiting-plan-approval', { phase: 'awaiting_plan_approval' }],
    ['awaiting-run-start', { phase: 'awaiting_run_start' }],
    ['compacting', { compacting: true }],
    ['queued-prompt', { queuedSends: 1 }],
    ['interrupting', { interrupting: true }],
    ['already-closing', { closing: true }],
    ['children-working', { hasUnsettledChildren: true }],
    ['browser-open', { hasOpenBrowser: true }],
    ['unapplied-model-choice', { hasPendingSettings: true }],
    ['agent-processes-running', { hasAgentProcesses: true }],
  ];

  for (const [label, patch] of blocked) {
    assert.deepEqual(
      retirableSessions([facts(label, 1_000, patch)], forever, IDLE_MS),
      [],
      `${label} must never be retired`,
    );
  }
});

interface OwnerHarness {
  owner: SessionRuntimeRetirement;
  retired: string[];
  errors: { appSessionId: string; message: string }[];
  live: Map<string, LiveSession>;
  clock: { now: number };
  // Reports these chats as the ones on screen, replacing the previous report.
  show(...appSessionIds: string[]): void;
  add(appSessionId: string, updatedAt: number, patch?: Partial<LiveSession>): LiveSession;
}

function liveSession(appSessionId: string, updatedAt: number): LiveSession {
  const summary = sessionSummary({ appSessionId, autonomy: 'off', streaming: false, updatedAt });
  const droid = new FakeFactorySession(appSessionId, {}, []);
  return {
    summary,
    session: fakeProviderSession(appSessionId, droid),
    droid,
    streaming: false,
    autoCompacting: false,
    pendingSends: [],
    steers: [],
    mcpServers: [],
    mcpConfigs: [],
  };
}

function ownerHarness(overrides: Partial<SessionRuntimeRetirementDependencies> = {}): OwnerHarness {
  const retired: string[] = [];
  const errors: { appSessionId: string; message: string }[] = [];
  const live = new Map<string, LiveSession>();
  let onScreen: ReadonlySet<string> | null = null;
  const clock = { now: 10_000 };
  const owner = new SessionRuntimeRetirement({
    liveSessions: () => [...live.values()],
    onScreenAppSessionIds: () => onScreen,
    hasUnsettledChildren: () => false,
    hasOpenBrowser: () => false,
    hasPendingSettings: () => false,
    hasAgentProcesses: () => false,
    hasLiveVoice: () => false,
    retire: (appSessionId) => {
      retired.push(appSessionId);
      live.delete(appSessionId);
      return Promise.resolve();
    },
    emitError: (appSessionId, message) => errors.push({ appSessionId, message }),
    idleMs: IDLE_MS,
    now: () => clock.now,
    ...overrides,
  });
  return {
    owner,
    retired,
    errors,
    live,
    clock,
    show(...appSessionIds) {
      const previous = onScreen;
      onScreen = new Set(appSessionIds);
      owner.noteOnScreen(previous);
    },
    add(appSessionId, updatedAt, patch = {}) {
      const session = Object.assign(liveSession(appSessionId, updatedAt), patch);
      live.set(appSessionId, session);
      return session;
    },
  };
}

test('only three settled off-screen runtimes stay warm, longest idle released first', async () => {
  const h = ownerHarness();
  try {
    h.add('newest', 4_000);
    h.add('oldest', 1_000);
    h.add('second', 2_000);
    h.add('third', 3_000);
    h.add('visible', 0);
    h.add('working', 0, { streaming: true });
    h.show('visible');

    assert.equal(h.owner.armedFor(), h.clock.now, 'exceeding the cap arms an immediate sweep');
    await h.owner.sweep();
    assert.deepEqual(h.retired, ['oldest']);

    h.clock.now = 2_000 + IDLE_MS - 1;
    await h.owner.sweep();
    assert.deepEqual(h.retired, ['oldest'], 'the remaining three keep their idle budget');

    h.clock.now = 4_000 + IDLE_MS;
    await h.owner.sweep();
    assert.deepEqual(h.retired, ['oldest', 'second', 'third', 'newest']);
    assert.deepEqual([...h.live.keys()], ['visible', 'working']);
  } finally {
    h.owner.stop();
  }
});

test('a failed release counts toward the cap while waiting five minutes to retry', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let failRelease = true;
  const h = ownerHarness({
    retire: (appSessionId) => {
      if (appSessionId === 'oldest' && failRelease)
        return Promise.reject(new Error('flush failed'));
      h.retired.push(appSessionId);
      h.live.delete(appSessionId);
      return Promise.resolve();
    },
  });
  try {
    h.add('oldest', 1_000);
    h.add('second', 2_000);
    h.add('third', 3_000);
    h.add('newest', 4_000);
    h.show();
    const retryAt = h.clock.now + 5 * 60_000;

    await h.owner.sweep();
    await h.owner.sweep();
    assert.deepEqual(h.retired, ['second']);
    assert.deepEqual([...h.live.keys()], ['oldest', 'third', 'newest']);
    assert.equal(h.errors.length, 1);
    assert.equal(h.owner.armedFor(), retryAt);

    h.clock.now = retryAt - 1;
    await h.owner.sweep();
    assert.deepEqual(h.retired, ['second']);
    assert.equal(h.errors.length, 1, 'a sweep during cooldown must not retry the release');

    failRelease = false;
    h.clock.now = retryAt;
    h.add('resumed', retryAt);
    await h.owner.sweep();
    assert.deepEqual(h.retired, ['second', 'oldest']);
    assert.deepEqual([...h.live.keys()], ['third', 'newest', 'resumed']);
    assert.equal(h.owner.armedFor(), 3_000 + IDLE_MS);
  } finally {
    h.owner.stop();
  }
});

test('an over-cap set of cooling-down runtimes waits for retry even past the idle budget', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let failRelease = true;
  const h = ownerHarness({
    retire: (appSessionId) => {
      if (failRelease) return Promise.reject(new Error('flush failed'));
      h.retired.push(appSessionId);
      h.live.delete(appSessionId);
      return Promise.resolve();
    },
  });
  try {
    h.add('oldest', 1_000);
    h.add('second', 2_000);
    h.add('third', 3_000);
    h.add('newest', 4_000);
    h.clock.now = IDLE_MS;
    h.show();
    const retryAt = h.clock.now + 5 * 60_000;

    for (let attempt = 0; attempt < 4; attempt++) await h.owner.sweep();
    assert.equal(h.errors.length, 4);
    assert.equal(h.live.size, 4);
    assert.equal(h.owner.armedFor(), retryAt, 'cooldowns must not arm an immediate sweep');

    h.clock.now = retryAt - 1;
    await h.owner.sweep();
    assert.equal(h.errors.length, 4, 'passing the idle budget must not bypass cooldown');
    assert.deepEqual(h.retired, []);
    assert.equal(h.owner.armedFor(), retryAt);

    failRelease = false;
    h.clock.now = retryAt;
    await h.owner.sweep();
    assert.deepEqual(h.retired, ['oldest', 'second', 'third', 'newest']);
    assert.equal(h.live.size, 0);
    assert.equal(h.owner.armedFor(), undefined);
  } finally {
    h.owner.stop();
  }
});

test('nothing is retirable until the renderer has reported what is on screen', async () => {
  const h = ownerHarness();
  h.add('background', 0);
  h.clock.now = IDLE_MS * 10;

  await h.owner.sweep();
  assert.deepEqual(h.retired, []);

  h.show('other');
  await h.owner.sweep();
  assert.deepEqual(h.retired, ['background']);
});

test('a session stays warm for a full budget after the user switches away, until it closes', async () => {
  const h = ownerHarness();
  h.add('read-for-a-while', 0);
  h.show('read-for-a-while');
  h.clock.now = IDLE_MS * 10;

  // Switching away starts the clock: an old updatedAt must not make a session
  // the user just left immediately retirable.
  h.show('elsewhere');
  await h.owner.sweep();
  assert.deepEqual(h.retired, []);

  h.clock.now += IDLE_MS;
  await h.owner.sweep();
  assert.deepEqual(h.retired, ['read-for-a-while']);

  // A closed session forgets when the user last looked at it, so one resumed
  // with nothing newer than its last turn is not kept warm by that moment.
  h.add('reopened', 0);
  h.show('reopened');
  h.show('elsewhere');
  h.live.delete('reopened');
  h.owner.arm();
  h.add('reopened', 0);
  await h.owner.sweep();
  assert.deepEqual(h.retired, ['read-for-a-while', 'reopened']);
});

test('every chat on screen stays warm, and each starts its clock as it leaves', async () => {
  const h = ownerHarness();
  h.add('left', 0);
  h.add('right', 0);
  h.clock.now = IDLE_MS * 10;
  h.show('left', 'right');
  await h.owner.sweep();
  assert.deepEqual(h.retired, []);

  h.show('left');
  await h.owner.sweep();
  assert.deepEqual(h.retired, [], 'leaving the screen starts the clock, it does not expire it');

  h.clock.now += IDLE_MS;
  await h.owner.sweep();
  assert.deepEqual(h.retired, ['right']);
});

test('a prompt that arrives during an earlier release saves the session behind it', async () => {
  let releaseSecond = (): void => undefined;
  const retired: string[] = [];
  const h = ownerHarness({
    retire: (appSessionId) => {
      retired.push(appSessionId);
      if (appSessionId !== 'first') return Promise.resolve();
      // Standing in for the awaited close of the session ahead in the queue.
      return new Promise<void>((resolve) => {
        releaseSecond = resolve;
      });
    },
  });
  h.add('first', 0);
  const second = h.add('second', 0);
  h.show('elsewhere');
  h.clock.now = IDLE_MS * 10;

  const sweeping = h.owner.sweep();
  second.streaming = true;
  releaseSecond();
  await sweeping;

  assert.deepEqual(retired, ['first'], 'a session that started a turn keeps its runtime');
});

test('overlapping retirement sweeps wait for the same pending close', async () => {
  let finishClose = (): void => undefined;
  const h = ownerHarness({
    retire: (id) => {
      h.retired.push(id);
      h.live.delete(id);
      return new Promise<void>((resolve) => {
        finishClose = resolve;
      });
    },
  });
  h.add('pending-close', 0);
  h.show('elsewhere');
  h.clock.now = IDLE_MS * 10;
  try {
    const first = h.owner.sweep();
    let finished = false;
    const second = h.owner.sweep().then(() => {
      finished = true;
    });
    await Promise.resolve();
    assert.equal(finished, false, 'an empty live set does not mean cleanup has finished');
    finishClose();
    await Promise.all([first, second]);
    assert.equal(finished, true);
    assert.deepEqual(h.retired, ['pending-close']);
  } finally {
    finishClose();
    h.owner.stop();
  }
});

test('a failed release is reported and does not stop the rest of the sweep', async () => {
  const h = ownerHarness({
    retire: (appSessionId) => {
      if (appSessionId === 'broken') return Promise.reject(new Error('flush failed'));
      h.retired.push(appSessionId);
      return Promise.resolve();
    },
  });
  h.add('broken', 0);
  h.add('fine', 0);
  h.show('elsewhere');
  h.clock.now = IDLE_MS * 10;

  await h.owner.sweep();
  assert.deepEqual(h.errors, [
    {
      appSessionId: 'broken',
      message: "Could not release this session's idle runtime: flush failed",
    },
  ]);
  assert.deepEqual(h.retired, ['fine']);
});

test('the timer is armed only while a session is actually retirable', () => {
  const scheduled: number[] = [];
  const realSetTimeout = globalThis.setTimeout;
  const realClearTimeout = globalThis.clearTimeout;
  Reflect.set(globalThis, 'setTimeout', (_fn: () => void, ms: number) => {
    scheduled.push(ms);
    return { unref: () => undefined };
  });
  Reflect.set(globalThis, 'clearTimeout', () => undefined);
  try {
    const h = ownerHarness();
    const streaming = h.add('streaming', 0, { streaming: true });
    h.show();

    h.owner.arm();
    assert.equal(h.owner.armedFor(), undefined, 'a streaming session must not arm a wakeup');
    assert.deepEqual(scheduled, []);

    streaming.streaming = false;
    h.owner.arm();
    assert.equal(h.owner.armedFor(), IDLE_MS);
    assert.deepEqual(scheduled, [IDLE_MS - h.clock.now]);

    h.live.clear();
    h.owner.arm();
    assert.equal(h.owner.armedFor(), undefined);

    h.add('idle-again', 0);
    h.owner.arm();
    assert.equal(h.owner.armedFor(), IDLE_MS);
    h.owner.stop();
    assert.equal(h.owner.armedFor(), undefined);

    h.owner.arm();
    assert.equal(h.owner.armedFor(), undefined, 'a stopped owner never arms again');
  } finally {
    Reflect.set(globalThis, 'setTimeout', realSetTimeout);
    Reflect.set(globalThis, 'clearTimeout', realClearTimeout);
  }
});
