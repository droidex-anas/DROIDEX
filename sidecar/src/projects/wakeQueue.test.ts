import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import { sessionSummary } from '../testing/sessionSummaryFixture.js';
import {
  drain,
  harness,
  input,
  interruptedSummary,
  summary,
  tick,
} from '../testing/projectServiceHarness.js';
import { LEDGER_LIMITS } from './store.js';
import type { ProjectPort } from './ProjectService.js';
import type { AutomationDeliveryReceipt } from '../automations/types.js';
import { threadReports } from '../../../src/features/projects/threadNotices.js';
import { ProjectWakeQueue, wakePrompt } from './ProjectWakeQueue.js';
import type { Project, ThreadMessage } from './types.js';

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
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
    todos: [],
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
    sessions?: Partial<Pick<ProjectPort, 'get' | 'isLive' | 'steer'>>;
    launch?: (project: Project, thread: Project['threads'][number]) => Promise<boolean>;
  } = {},
): ProjectWakeQueue {
  const queue = new ProjectWakeQueue(
    {
      deliver,
      steer: async (target, prompt, _isCurrent, _now, delivery) => {
        const receipt = await deliver(target, prompt);
        if (receipt.status !== 'accepted') return false;
        delivery?.accepted();
        delivery?.acknowledged?.();
        return true;
      },
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

test('a report refused before handoff stays unchanged and delivers once after availability', async (t) => {
  const state = project();
  const pending = structuredClone(state.pending);
  let attempts = 0;
  const sent: string[] = [];
  const queue = wakeQueue(
    t,
    async (_target, prompt) => {
      attempts += 1;
      if (attempts === 1) return { status: 'busy', retryOn: 'target' };
      sent.push(prompt);
      return { status: 'accepted', settled: Promise.resolve() };
    },
    { sessions: { get: () => sessionSummary({ streaming: true }) } },
  );
  queue.kick(state);
  await drain();
  assert.deepEqual(state.pending, pending);
  assert.equal(state.delivery, undefined);
  queue.kick(state);
  await drain();
  assert.equal(attempts, 1);
  queue.available(state, 'main');
  await drain();
  assert.equal(state.pending.length, 0);
  assert.equal(state.delivery, undefined);
  queue.available(state, 'main');
  await drain();
  assert.equal(attempts, 2);
  assert.equal(sent.length, 1);
  assert.match(sent[0], /Worker reported back \(thread worker\):\nfirst/);
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

test('reports steer through a full delivery gate and settle at handoff', async (t) => {
  const first = project('first');
  const second = project('second');
  second.pending[0].to = 'other';
  const report = project('report');
  report.threads[0].appSessionId = 'running';
  report.threads[1].ownerAppSessionId = 'running';
  report.pending[0].to = 'running';
  const finished = deferred<void>();
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
        steer: async (_target, prompt, _current, _now, delivery) => {
          delivery?.accepted();
          steers.push(prompt);
          return true;
        },
      },
    },
  );
  queue.start([first, second, report]);
  await tick();
  await tick();
  assert.equal(wakes.length, 2);
  assert.equal(steers.length, 1);
  assert.equal(report.delivery, undefined);
  assert.match(steers[0], /Worker reported back \(thread worker\)/);
  assert.equal(report.pending.length, 0);
  running = false;
  queue.available(report, 'running');
  finished.resolve();
  await tick();
  assert.equal(wakes.length, 2, 'a handed-off steer cannot wake the owner again');
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
      queuedSpawn: { phase: 'queued', input, order: index + 1 },
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

test('a lost report push survives restart as unread and appears in the next wake', async (t) => {
  t.mock.timers.enable({ apis: ['Date', 'setTimeout'], now: 1_000_000 });
  const h = await harness(t);
  const { main } = await h.root();
  const child = await h.projects.spawn(main, { ...input, title: 'Parser' });
  await h.streaming(main, true);
  let disk: Project[] = [];
  h.port.steer = async (_target, _prompt, _current, _now, delivery) => {
    delivery?.accepted();
    // Crash before the handoff's next save, with no provider acknowledgement.
    disk = structuredClone(h.state.saved);
    return true;
  };
  await h.finish(child.appSessionId, 'Parsed the config.');
  await drain();
  assert.equal(disk[0]?.delivery?.state, 'sending');
  await h.projects.userStopped(main);
  assert.equal(h.projects.listThreads(main).threads[0]?.unread, true);
  h.projects.close();
  const recovered = await harness(t, disk, false);
  recovered.sessions.set(main, summary(main));
  recovered.sessions.set(child.appSessionId, summary(child.appSessionId));
  recovered.projects.historyReady();
  await drain();
  assert.equal(recovered.projects.list()[0]?.paused, false);
  assert.equal(recovered.state.saved[0]?.delivery, undefined);
  assert.equal(recovered.sent.length, 0, 'a lost push is never replayed');
  assert.equal(recovered.projects.listThreads(main).threads[0]?.unread, true);
  await recovered.projects.addTodo(main, { text: 'Review the parser', inMinutes: 1 });
  t.mock.timers.tick(60_000);
  await drain();
  assert.equal(recovered.sent.length, 1);
  assert.match(recovered.sent[0].prompt, /Unread threads: Parser/);
  assert.doesNotMatch(recovered.sent[0].prompt, /Parsed the config/);
  assert.equal(recovered.projects.listThreads(main).threads[0]?.unread, true);
  await recovered.finish(main);
});

test('restart drains reports, queued starts and interrupted threads only after history is ready', async (t) => {
  const h = await harness(t, [], false);
  const { main } = await h.root();
  const child = await h.projects.spawn(main, input);
  h.state.capacity = 'busy';
  const queued = await h.projects.spawn(main, { ...input, title: 'Queued work' });
  assert.deepEqual([queued.state, queued.position], ['queued', 1]);
  const listed = h.projects
    .listThreads(main)
    .threads.find((thread) => thread.threadId === queued.appSessionId);
  assert.deepEqual(
    [listed?.state, listed?.position, listed?.waitReason],
    ['queued', 1, 'queued to start · 1st'],
  );
  assert.deepEqual(h.projects.read(main, queued.appSessionId).runtimeLoad, { live: 20, limit: 20 });
  // Before startup reconciliation finishes, reports stay durable and undelivered.
  await h.finish(child.appSessionId, 'Parsed the config.');
  const disk = structuredClone(h.state.saved);
  assert.equal(disk[0]?.pending.length, 1);
  assert.equal(disk[0]?.delivery, undefined);

  const recovered = await harness(t, disk, false);
  assert.equal(recovered.projects.read(main, queued.appSessionId).state, 'queued');
  assert.equal(recovered.projects.read(main, queued.appSessionId).position, 1);
  recovered.sessions.set(main, summary(main));
  recovered.sessions.set(child.appSessionId, interruptedSummary(child.appSessionId));
  // The lead settling would wake it, but history does not know its threads yet.
  await recovered.streaming(main, false);
  await drain();
  assert.equal(recovered.sent.length, 0);

  recovered.projects.historyReady();
  await drain();
  const prompts = new Map(recovered.sent.map(({ id, prompt }) => [id, prompt]));
  assert.match(prompts.get(main) ?? '', /Parsed the config/);
  const continuation =
    'DROIDEX restarted while you were working. Continue from where you stopped; your worktree and history are intact.';
  assert.ok(prompts.get(child.appSessionId)?.includes(continuation));
  assert.equal(recovered.sessions.get(queued.appSessionId)?.title, 'Queued work');
  const threads = recovered.state.saved[0]?.threads;
  const started = threads?.find((thread) => thread.appSessionId === queued.appSessionId);
  assert.equal(started?.queuedSpawn, undefined);
  assert.equal(recovered.projects.list()[0]?.paused, false);

  const queuedMessage = {
    id: 'next-task',
    from: main,
    to: child.appSessionId,
    kind: 'message' as const,
    text: 'Continue with the tests.',
  };
  disk[0].pending.push(queuedMessage);
  const withMessage = await harness(t, disk, false);
  withMessage.sessions.set(main, summary(main));
  withMessage.sessions.set(child.appSessionId, interruptedSummary(child.appSessionId));
  withMessage.projects.historyReady();
  await drain();
  const resumed = withMessage.sent.filter(({ id }) => id === child.appSessionId);
  assert.equal(resumed.length, 1);
  assert.equal(resumed[0]?.prompt.split(queuedMessage.text).length, 2);
  assert.ok(!resumed[0]?.prompt.includes(continuation));
});

test('timed to-dos survive restart and a full held inbox, then steer into a busy lead once', async (t) => {
  t.mock.timers.enable({ apis: ['Date', 'setTimeout'], now: 1_000_000 });
  const h = await harness(t);
  const { id, main } = await h.root();
  const child = await h.projects.spawn(main, input);
  await h.projects.setPaused(id, true);
  const todo = await h.projects.addTodo(main, { text: 'Check the build', inMinutes: 1 });
  const cancelled = await h.projects.addTodo(main, { text: 'Cancelled reminder', inMinutes: 1 });
  await h.projects.doneTodo(main, cancelled.id);
  h.projects.close();
  const disk = structuredClone(h.state.saved);
  disk[0].pending = Array.from({ length: LEDGER_LIMITS.inbox }, (_, index) => ({
    id: `report-${String(index)}`,
    from: index === 0 ? child.appSessionId : main,
    to: index === 0 ? main : child.appSessionId,
    kind: index === 0 ? 'result' : 'message',
    text: index === 0 ? 'Report' : 'Next task',
  }));
  const restored = await harness(t, disk, false);
  restored.sessions.set(main, summary(main));
  restored.sessions.set(child.appSessionId, summary(child.appSessionId));
  await restored.streaming(main, true);
  await restored.streaming(child.appSessionId, true);
  t.mock.timers.tick(60_000);
  await drain();
  assert.equal(restored.steered.length, 0);
  restored.projects.historyReady();
  await drain();
  t.mock.timers.tick(0);
  await drain();
  assert.equal(restored.state.saved[0]?.todos[0]?.due, true);
  assert.equal(restored.state.saved[0]?.todos[0]?.notified, undefined);
  assert.equal(restored.projects.list()[0]?.queued, LEDGER_LIMITS.inbox);
  await restored.projects.setPaused(id, false);
  await drain();
  const reminders = restored.steered.filter(({ prompt }) =>
    prompt.includes('Reminder — follow-up due'),
  );
  assert.equal(reminders.length, 1);
  assert.match(reminders[0]?.prompt ?? '', /Check the build/);
  assert.ok(
    restored.steered.every(
      ({ id, prompt }) => id === main && !prompt.includes('Cancelled reminder'),
    ),
  );
  assert.equal(restored.sent.length, 0);
  await restored.finish(main);
  t.mock.timers.tick(60_000);
  await drain();
  assert.equal(restored.sent.length, 0);
  await restored.projects.doneTodo(main, todo.id);
  assert.deepEqual(restored.state.saved[0]?.todos, []);
});

test('a full restart inbox consumes its existing instruction without a second continuation', async (t) => {
  const saved = project();
  saved.pending = Array.from({ length: LEDGER_LIMITS.inbox }, (_, index) =>
    index === 0
      ? { id: 'instruction', from: 'main', to: 'worker', kind: 'message', text: 'Finish tests' }
      : message(`report-${String(index)}`),
  );
  const h = await harness(t, [saved], false);
  h.sessions.set('main', summary('main'));
  h.sessions.set('worker', interruptedSummary('worker'));
  await h.streaming('main', true);
  h.projects.historyReady();
  await drain();
  assert.equal(h.sent.filter(({ id }) => id === 'worker').length, 1);
  await h.finish('worker');
  await drain();
  const instructions = h.sent.filter(({ id }) => id === 'worker');
  assert.equal(instructions.length, 1);
  assert.match(instructions[0].prompt, /Finish tests/);
  assert.equal(
    h.state.saved[0]?.pending.some((note) => note.to === 'worker'),
    false,
  );
});

test('a resume behind its own report claim does not block another project from starting', async (t) => {
  const reports = project('reports');
  reports.threads[1].appSessionId = 'dormant';
  reports.pending[0].from = 'dormant';
  const admission = deferred<void>();
  const starts: string[] = [];
  const queue = wakeQueue(t, async () => ({ status: 'busy', retryOn: 'target' }), {
    sessions: {
      get: (id) => (id === 'main' ? sessionSummary({ streaming: true }) : undefined),
      isLive: (id) => id !== 'dormant',
      steer: async (_target, _prompt, _current, _now, delivery) => {
        await admission.promise;
        delivery?.accepted();
        return true;
      },
    },
    launch: async (_project, thread) => {
      starts.push(thread.appSessionId);
      delete thread.queuedSpawn;
      return true;
    },
  });
  queue.kick(reports);
  await drain();
  assert.ok(reports.delivery);
  reports.pending.push({ id: 'resume', from: 'main', to: 'dormant', kind: 'message', text: 'Go' });
  const waiting = project('waiting');
  waiting.pending = [];
  waiting.threads[1].queuedSpawn = { phase: 'queued', input, order: 1 };
  queue.capacityChanged([reports, waiting]);
  await drain();
  const startedBeforeAdmission = [...starts];
  admission.resolve();
  await drain();
  assert.deepEqual(startedBeforeAdmission, ['worker']);
});

test('a queued spawn waits for its own project resumes hidden by a report claim', async (t) => {
  const state = project();
  const admission = deferred<void>();
  const order: string[] = [];
  const queue = wakeQueue(
    t,
    async (target) => {
      order.push(target);
      return { status: 'accepted', settled: Promise.resolve() };
    },
    {
      sessions: {
        get: (id) => (id === 'main' ? sessionSummary({ streaming: true }) : undefined),
        isLive: (id) => id === 'main',
        steer: async (_target, _prompt, _current, _now, delivery) => {
          await admission.promise;
          delivery?.accepted();
          return true;
        },
      },
      launch: async (_project, thread) => {
        order.push(thread.appSessionId);
        delete thread.queuedSpawn;
        return true;
      },
    },
  );
  queue.kick(state);
  await drain();
  assert.ok(state.delivery);
  state.threads.push({
    appSessionId: 'queued',
    ownerAppSessionId: 'main',
    title: 'Queued',
    reply: '',
    waiting: false,
    queuedSpawn: { phase: 'queued', input, order: 1 },
  });
  state.pending.push({ id: 'resume', from: 'main', to: 'worker', kind: 'message', text: 'Go' });
  queue.capacityChanged([state]);
  await drain();
  const beforeAdmission = [...order];
  admission.resolve();
  await drain();
  assert.deepEqual(beforeAdmission, []);
  assert.deepEqual(order, ['worker', 'queued']);
});

test('a busy streaming recipient retries only after availability changes', async (t) => {
  const state = project();
  const pending = structuredClone(state.pending);
  let attempts = 0;
  let saves = 0;
  const queue = wakeQueue(
    t,
    async () => {
      attempts += 1;
      return { status: 'busy', retryOn: 'target' };
    },
    {
      sessions: { get: () => sessionSummary({ streaming: true }) },
      save: async () => {
        saves += 1;
      },
    },
  );
  queue.kick(state);
  await drain();
  assert.equal(attempts, 1);
  assert.deepEqual(state.pending, pending);
  assert.equal(state.delivery, undefined);
  const parkedSaves = saves;
  queue.kick(state);
  await drain();
  assert.equal(attempts, 1);
  assert.equal(saves, parkedSaves);
  queue.available(state, 'main');
  await drain();
  assert.equal(attempts, 2);
});

test('wake to-dos are separate from the last worker report rendered in the chat', () => {
  const state = project();
  state.todos = [{ id: 'review', text: 'Review the parser' }];
  state.pending[0].text = 'Done.';
  const prompt = wakePrompt(state, 'main', state.pending);
  assert.match(prompt, /Open to-dos:\n- review: Review the parser/);
  assert.deepEqual(threadReports(prompt), [
    {
      lead: 'Worker reported back',
      body: 'Done.',
      from: { threadId: 'worker', name: 'Worker', action: 'reported back' },
    },
  ]);
});

test('a capacity refusal publishes its wait in the last renderer snapshot', async (t) => {
  const h = await harness(t);
  const { main } = await h.root();
  const child = await h.projects.spawn(main, input);
  h.state.capacity = 'busy';
  await h.finish(child.appSessionId);
  await drain();
  const snapshot = h.events.findLast((event) => event.type === 'projects.snapshot');
  assert.ok(snapshot?.type === 'projects.snapshot');
  const published = snapshot.projects[0]?.threads.find((thread) => thread.appSessionId === main);
  assert.equal(published?.state, 'waiting');
  assert.deepEqual(published?.wait, { kind: 'slot', position: 1 });
});

test('waiting resumes block queued spawns while both delivery slots are occupied', async (t) => {
  const states = [project('first'), project('second'), project('resume'), project('spawn')];
  states[1].pending[0].to = 'other-live';
  states[2].pending[0].to = 'sleeping';
  states[3].pending = [];
  states[3].threads[1].queuedSpawn = { phase: 'queued', input, order: 1 };
  const finished = deferred<void>();
  const order: string[] = [];
  const queue = wakeQueue(
    t,
    async (target) => {
      order.push(target);
      return {
        status: 'accepted',
        settled: target === 'sleeping' ? Promise.resolve() : finished.promise,
      };
    },
    {
      sessions: { isLive: (id) => id !== 'sleeping' },
      launch: async (_project, thread) => {
        order.push('spawn');
        delete thread.queuedSpawn;
        return true;
      },
    },
  );
  queue.start(states);
  await drain();
  const beforeSettlement = [...order];
  finished.resolve();
  await drain();
  assert.deepEqual(beforeSettlement, ['main', 'other-live']);
  assert.deepEqual(order, ['main', 'other-live', 'sleeping', 'spawn']);
});
