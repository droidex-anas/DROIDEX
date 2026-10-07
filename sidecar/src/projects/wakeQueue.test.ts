import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import { sessionSummary } from '../testing/sessionSummaryFixture.js';
import type { ProjectPort } from './ProjectService.js';
import type { AutomationDeliveryReceipt } from '../automations/types.js';
import { ProjectWakeQueue } from './ProjectWakeQueue.js';
import type { Project, ThreadMessage } from './types.js';

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
const tick = () => new Promise<void>((resolve) => setImmediate(resolve));
function message(id: string, target = 'main'): ThreadMessage {
  return { id, from: 'worker', to: target, kind: 'result', text: id };
}
function project(id = 'project'): Project {
  return {
    id,
    title: id,
    paused: false,
    launching: 0,
    plan: [],
    threads: [
      { appSessionId: 'main', title: 'Main', reply: '', waiting: false },
      {
        appSessionId: 'worker',
        ownerAppSessionId: 'main',
        title: 'Worker',
        reply: '',
        waiting: false,
      },
    ],
    pending: [message('first')],
  };
}

/** A started wake queue over `deliver`, closed and flushed when the test ends. */
function wakeQueue(
  t: TestContext,
  deliver: (target: string, prompt: string) => Promise<AutomationDeliveryReceipt>,
  options: {
    save?: () => Promise<void>;
    fail?: (error: unknown) => void;
    sessions?: Partial<Pick<ProjectPort, 'get' | 'isLive' | 'deliverReport'>>;
    launch?: (project: Project, thread: Project['threads'][number]) => Promise<boolean>;
  } = {},
): ProjectWakeQueue {
  const queue = new ProjectWakeQueue(
    {
      deliver,
      deliverReport: deliver,
      awaitingApproval: () => false,
      get: () => undefined,
      isLive: () => true,
      ...options.sessions,
    },
    options.save ?? (() => Promise.resolve()),
    (_project, error) => {
      if (!options.fail) throw error;
      options.fail(error);
    },
    () => undefined,
    options.launch,
  );
  queue.start([]);
  t.after(async () => {
    queue.close();
    await queue.flush();
  });
  return queue;
}

test('acceptance removes only its claim and holds the turn slot until completion', async (t) => {
  const state = project();
  const admitted = deferred<AutomationDeliveryReceipt>();
  const finished = deferred<void>();
  const calls: string[] = [];
  let saved: Project | undefined;
  const queue = wakeQueue(
    t,
    async (_target, prompt) => {
      calls.push(prompt);
      if (calls.length === 1) return admitted.promise;
      return { status: 'accepted', settled: Promise.resolve() };
    },
    {
      save: async () => {
        saved = structuredClone(state);
      },
    },
  );
  queue.kick(state);
  await tick();
  assert.equal(saved?.delivery?.state, 'sending');
  state.pending.push(message('arrived-during-admission'));
  queue.kick(state);
  admitted.resolve({ status: 'accepted', settled: finished.promise });
  await tick();
  assert.deepEqual(
    state.pending.map((item) => item.id),
    ['arrived-during-admission'],
  );
  queue.available(state, 'main');
  await tick();
  assert.equal(calls.length, 1, 'a live accepted turn still owns its slot');
  finished.resolve();
  await tick();
  await tick();
  assert.equal(calls.length, 2);
  assert.match(calls[1], /arrived-during-admission/);
  assert.doesNotMatch(calls[1], /"first"/);
});

test('availability arriving during an awaited busy receipt is not lost', async (t) => {
  const state = project();
  const receipt = deferred<AutomationDeliveryReceipt>();
  let calls = 0;
  const queue = wakeQueue(t, async () => {
    calls += 1;
    if (calls === 1) return receipt.promise;
    return { status: 'accepted', settled: Promise.resolve() };
  });
  queue.kick(state);
  await tick();
  queue.available(state, 'main');
  receipt.resolve({ status: 'busy', retryOn: 'target' });
  await tick();
  await tick();
  assert.equal(calls, 2);
});

test('capacity waits block only that recipient until availability', async (t) => {
  const state = project();
  const targets: string[] = [];
  const queue = wakeQueue(t, async (target) => {
    targets.push(target);
    return targets.length === 1
      ? { status: 'busy', retryOn: 'capacity' }
      : { status: 'accepted', settled: Promise.resolve() };
  });
  queue.kick(state);
  await tick();
  await tick();
  assert.deepEqual(targets, ['main']);

  state.pending.push(message('worker-message', 'worker'));
  queue.kick(state);
  await tick();
  await tick();
  assert.deepEqual(targets, ['main', 'worker']);

  state.pending.push(message('main-again'));
  queue.available(state, 'main');
  await tick();
  await tick();
  assert.deepEqual(targets, ['main', 'worker', 'main']);
});

test('an unacknowledged delivery keeps its claim and is not retried', async (t) => {
  const state = project();
  let calls = 0;
  const failures: unknown[] = [];
  const queue = wakeQueue(
    t,
    async () => {
      calls += 1;
      return { status: 'unavailable', error: 'Delivery outcome unknown' };
    },
    { fail: (error) => failures.push(error) },
  );
  queue.kick(state);
  await tick();
  queue.available(state, 'main');
  queue.capacityChanged([state]);
  await tick();
  assert.equal(calls, 1);
  assert.equal(failures.length, 1);
  assert.equal(state.delivery?.messages[0]?.id, 'first');
});

test('completed callbacks free the global limit of two accepted project turns', async (t) => {
  const states = [project('one'), project('two'), project('three')];
  states.forEach((item, index) => {
    item.pending[0].to = `main-${String(index)}`;
  });
  const finished = deferred<void>();
  let calls = 0;
  const queue = wakeQueue(t, async () => {
    calls += 1;
    return { status: 'accepted', settled: finished.promise };
  });
  states.forEach((item) => queue.kick(item));
  await tick();
  await tick();
  assert.equal(calls, 2);
  finished.resolve();
  await tick();
  await tick();
  assert.equal(calls, 3);
});

test('explicit resume rechecks both target and capacity busy markers', async (t) => {
  for (const retryOn of ['target', 'capacity'] as const) {
    const state = project();
    let calls = 0;
    const queue = wakeQueue(t, async () => {
      calls += 1;
      if (calls === 1) return { status: 'busy', retryOn };
      return { status: 'accepted', settled: Promise.resolve() };
    });
    queue.kick(state);
    await tick();
    await tick();
    assert.equal(calls, 1);
    state.paused = true;
    queue.invalidate(state);
    state.paused = false;
    queue.invalidate(state);
    queue.kick(state);
    await tick();
    await tick();
    assert.equal(calls, 2, retryOn + ' must be rechecked on explicit resume');
    assert.equal(state.pending.length, 0);
  }
});

test('a cancelled admission cannot restore a busy marker after resume', async (t) => {
  const state = project();
  const admitted = deferred<AutomationDeliveryReceipt>();
  let calls = 0;
  const queue = wakeQueue(t, async () => {
    calls += 1;
    if (calls === 1) return admitted.promise;
    return { status: 'accepted', settled: Promise.resolve() };
  });
  queue.kick(state);
  await tick();
  state.paused = true;
  queue.invalidate(state);
  admitted.resolve({ status: 'busy', retryOn: 'target' });
  await tick();
  state.paused = false;
  queue.invalidate(state);
  queue.kick(state);
  await tick();
  await tick();
  assert.equal(calls, 2);
  assert.equal(state.pending.length, 0);
});

test('reports steer through a full delivery gate and keep their claim until acknowledgement', async (t) => {
  const first = project('first');
  const second = project('second');
  second.pending[0].to = 'other';
  const report = project('report');
  report.threads[0].appSessionId = 'running';
  report.threads[1].ownerAppSessionId = 'running';
  report.pending[0].to = 'running';
  const finished = deferred<void>();
  const acknowledged = deferred<AutomationDeliveryReceipt>();
  const wakes: string[] = [];
  const steers: string[] = [];
  let running = true;
  const queue = wakeQueue(
    t,
    async (target) => {
      wakes.push(target);
      return { status: 'accepted', settled: finished.promise };
    },
    {
      sessions: {
        get: (id) =>
          id === 'running' ? sessionSummary({ appSessionId: id, streaming: running }) : undefined,
        deliverReport: async (_target, prompt) => {
          steers.push(prompt);
          return acknowledged.promise;
        },
      },
    },
  );
  queue.start([first, second, report]);
  await tick();
  await tick();
  assert.equal(wakes.length, 2);
  assert.equal(steers.length, 1);
  assert.equal(report.delivery?.messages[0]?.id, 'first');
  assert.match(steers[0], /Worker reported back \(thread worker\)/);
  acknowledged.resolve({ status: 'accepted', settled: Promise.resolve() });
  await tick();
  assert.equal(report.delivery, undefined);
  assert.equal(report.pending.length, 0);
  running = false;
  queue.available(report, 'running');
  finished.resolve();
  await tick();
  assert.equal(wakes.length, 2, 'an acknowledged steer cannot wake the owner again');
});

test('existing resume admissions precede queued starts, which launch in FIFO order', async (t) => {
  const state = project();
  state.pending[0].to = 'stopped';
  const input = {
    title: 'Work',
    prompt: 'Do it',
    provider: 'droid' as const,
    autonomy: 'low' as const,
  };
  for (const [index, id] of ['new-first', 'new-second'].entries())
    state.threads.push({
      appSessionId: id,
      ownerAppSessionId: 'main',
      title: id,
      reply: '',
      waiting: false,
      queuedSpawn: { input, order: index + 1 },
    });
  const admitted = deferred<AutomationDeliveryReceipt>();
  const finished = deferred<void>();
  const starts: string[] = [];
  const queue = wakeQueue(t, async () => admitted.promise, {
    sessions: { isLive: (id) => id !== 'stopped' },
    launch: async (_project, thread) => {
      starts.push(thread.appSessionId);
      delete thread.queuedSpawn;
      return true;
    },
  });
  queue.kick(state);
  await tick();
  assert.deepEqual(queue.waitReason('new-first'), { kind: 'start', position: 1 });
  assert.deepEqual(queue.waitReason('new-second'), { kind: 'start', position: 2 });
  assert.deepEqual(starts, []);
  admitted.resolve({ status: 'accepted', settled: finished.promise });
  await tick();
  await tick();
  await tick();
  assert.deepEqual(starts, ['new-first', 'new-second']);
  assert.equal(queue.waitReason('new-first'), undefined);
  finished.resolve();
});
