import assert from 'node:assert/strict';
import test from 'node:test';
import { sessionSummary } from '../testing/sessionSummaryFixture.js';
import {
  deferred,
  drain,
  wakeMessage as message,
  wakeProject as project,
  wakeQueue,
  queuedThread,
  harness,
  input,
  interruptedSummary,
  projectWithThread,
  summary,
  tick,
} from '../testing/projectServiceHarness.js';
import { LEDGER_LIMITS } from './store.js';
import type { AutomationDeliveryReceipt } from '../automations/types.js';
import { threadReports } from '../../../src/features/projects/threadNotices.js';
import { wakePrompt } from './projectMessages.js';
import type { Project } from './types.js';

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
  await drain();
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
  await drain();
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
  await drain();
  assert.deepEqual(targets, ['main']);

  state.pending.push(message('worker-message', 'worker'));
  queue.kick(state);
  await drain();
  assert.deepEqual(targets, ['main', 'worker']);

  state.pending.push(message('main-again'));
  queue.available(state, 'main');
  await drain();
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

test('completed callbacks free the global limit of two accepted worker turns', async (t) => {
  const states = [project('first'), project('second'), project('third')];
  states.forEach((item) => {
    item.pending[0].to = item.id;
  });
  states[0].pending.push(message('first-backlog', 'first-next'));
  const firstFinished = deferred<void>();
  const finished = deferred<void>();
  t.after(() => {
    firstFinished.resolve();
    finished.resolve();
  });
  const order: string[] = [];
  const queue = wakeQueue(t, async (target) => {
    order.push(target);
    return {
      status: 'accepted',
      settled: target === 'first' ? firstFinished.promise : finished.promise,
    };
  });
  queue.start(states);
  await drain();
  assert.equal(order.length, 2);
  assert.deepEqual(order, ['first', 'second']);
  firstFinished.resolve();
  await drain();
  assert.equal(order.length, 3);
  assert.deepEqual(order, ['first', 'second', 'third']);
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
  await drain();
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
  await drain();
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

  for (const [index, id] of ['new-first', 'new-second'].entries())
    state.threads.push(queuedThread(id, index + 1));
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
  await drain();
  await tick();
  assert.deepEqual(starts, ['new-first', 'new-second']);
  assert.equal(queue.waitReason('new-first'), undefined);
  finished.resolve();
});

test('acknowledging eight queued reports does not mark the ninth reply read', async (t) => {
  const { h, id, main, child } = await projectWithThread(t, { ...input, title: 'Parser' });
  await h.finish(child.appSessionId, '');
  await drain();
  await h.finish(main, '');
  h.sent.length = 0;
  await h.projects.setPaused(id, true);
  for (let index = 1; index <= 9; index += 1) {
    await h.streaming(child.appSessionId, true);
    await h.finish(child.appSessionId, `Reply ${index}`);
  }
  const finished = deferred<void>();
  h.port.deliver = async (target, prompt) => {
    h.sent.push({ id: target, prompt });
    return {
      status: 'accepted',
      settled: h.sent.length === 1 ? finished.promise : Promise.resolve(),
    };
  };
  await h.projects.setPaused(id, false);
  await drain();
  assert.equal(h.sent.length, 1);
  assert.match(h.sent[0].prompt, /Reply 8/);
  assert.doesNotMatch(h.sent[0].prompt, /Reply 9/);
  assert.equal(h.state.saved[0]?.pending.length, 1);
  assert.equal(h.state.saved[0]?.pending[0]?.text, 'Reply 9');
  assert.equal(h.projects.listThreads(main).threads[0]?.unread, true);
  assert.equal(h.state.saved[0]?.threads[1]?.unread, true);
  finished.resolve();
  await drain();
  assert.equal(h.sent.length, 2);
  assert.match(h.sent[1].prompt, /Reply 9/);
  assert.equal(h.state.saved[0]?.threads[1]?.unread, undefined);
});

test('Resume wakes an idle lead to read a lost handed-off report with an empty inbox', async (t) => {
  const { h, id, main, child } = await projectWithThread(t, { ...input, title: 'Parser' });
  await h.streaming(main, true);
  h.port.steer = async (_target, _prompt, _current, _now, delivery) => {
    delivery?.accepted();
    return true;
  };
  await h.finish(child.appSessionId, 'Parsed the config.');
  await drain();
  await h.projects.userStopped(main);
  await h.streaming(main, false);
  assert.equal(h.state.saved[0]?.pending.length, 0);
  assert.equal(h.state.saved[0]?.delivery, undefined);
  assert.equal(h.sent.length, 0);
  await h.projects.setPaused(id, false);
  await drain();
  assert.equal(h.sent.length, 1);
  assert.equal(h.sent[0].id, main);
  assert.match(h.sent[0].prompt, /Unread threads: Parser\. Read them with thread_read\./);
  assert.doesNotMatch(h.sent[0].prompt, /Parsed the config/);
  assert.equal(h.sessions.get(main)?.streaming, true);
  assert.equal(h.state.saved[0]?.threads[1]?.unread, true);
  await h.finish(main);
});

test('a lost report push survives restart as unread and appears in the next wake', async (t) => {
  t.mock.timers.enable({ apis: ['Date', 'setTimeout'], now: 1_000_000 });
  const { h, main, child } = await projectWithThread(t, { ...input, title: 'Parser' });
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

test('restart retains report-only sending claims for failed, stopped and empty turns without replies', async (t) => {
  for (const [phase, text] of [
    ['failed', 'It failed before finishing.\nModel provider refused the request.'],
    ['paused', 'It was stopped before it finished.'],
    ['running', 'It ended its turn without a reply.'],
  ] as const) {
    const saved = project();
    saved.paused = true;
    const report = { ...message('report'), text };
    saved.delivery = { state: 'sending', messages: [report] };
    saved.pending = [];
    const h = await harness(t, [saved], false);
    h.sessions.set('main', summary('main'));
    h.sessions.set('worker', { ...summary('worker'), phase });
    assert.deepEqual(h.projects.read('main', 'worker').replies, []);
    assert.deepEqual(h.state.saved[0]?.pending, [report]);
    assert.equal(h.state.saved[0]?.delivery, undefined);
    assert.equal(h.projects.listThreads('main').threads[0]?.threadId, 'worker');
    h.projects.historyReady();
    await drain();
    assert.equal(h.sent.length, 0, 'recovery respects the hold');
    await h.projects.setPaused(saved.id, false);
    await drain();
    assert.equal(h.sent.length, 1);
    assert.ok(h.sent[0].prompt.includes(text));
    assert.deepEqual(h.state.saved[0]?.pending, []);
    await h.finish('main');
    await drain();
    assert.equal(h.sent.length, 1, 'the recovered report is delivered once');
  }
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
  const { h, id, main, child } = await projectWithThread(t);
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
  state.threads.push(queuedThread('queued', 1));
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
  const { h, main, child } = await projectWithThread(t);
  h.state.capacity = 'busy';
  await h.finish(child.appSessionId);
  await drain();
  const snapshot = h.events.findLast((event) => event.type === 'projects.snapshot');
  assert.ok(snapshot?.type === 'projects.snapshot');
  const published = snapshot.projects[0]?.threads.find((thread) => thread.appSessionId === main);
  assert.equal(published?.state, 'waiting');
  assert.deepEqual(published?.wait, { kind: 'slot', position: 1 });
});

test('worker resumes precede queued starts while reports wait for a released stopped lead', async (t) => {
  const states = [project('first'), project('second'), project('resume'), project('spawn')];
  states[0].pending[0].to = 'worker';
  states[1].pending[0].to = 'other-live';
  states[2].pending[0].to = 'sleeping';
  states[3].leadStopped = true;
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
      sessions: { isLive: (id) => id !== 'sleeping' && id !== 'main' },
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
  assert.deepEqual(beforeSettlement, ['worker', 'other-live']);
  assert.deepEqual(order, ['worker', 'other-live', 'sleeping', 'spawn']);
});

test('a sleeping lead wakes through two occupied worker slots before a new worker starts', async (t) => {
  const state = project();
  state.threads.push({ ...state.threads[1], appSessionId: 'second', title: 'Second' });
  state.pending = ['worker', 'second'].map((to) => ({
    id: to,
    from: 'main',
    to,
    kind: 'message',
    text: 'Work',
  }));
  const workersFinished = deferred<void>();
  const leadAdmitted = deferred<AutomationDeliveryReceipt>();
  const order: string[] = [];
  const queue = wakeQueue(
    t,
    async (target) => {
      order.push(target);
      return target === 'main'
        ? leadAdmitted.promise
        : { status: 'accepted', settled: workersFinished.promise };
    },
    {
      launch: async (_project, thread) => {
        order.push('spawn');
        delete thread.queuedSpawn;
        return true;
      },
    },
  );
  queue.kick(state);
  await drain();
  assert.deepEqual(order, ['worker', 'second']);
  state.pending.push(message('lead-wake'));
  state.threads.push(queuedThread('new', 1));
  queue.kick(state);
  await drain();
  assert.deepEqual(order, ['worker', 'second', 'main']);
  leadAdmitted.resolve({ status: 'accepted', settled: Promise.resolve() });
  await drain();
  assert.deepEqual(order, ['worker', 'second', 'main', 'spawn']);
  workersFinished.resolve();
});

test('the delivery loop guard allows a large team to report before holding a repeated loop', async (t) => {
  const state = project();
  for (let i = 2; i < 120; i += 1)
    state.threads.push({ ...state.threads[1], appSessionId: `worker-${i}` });
  let delivered = 0;
  let error = '';
  const queue = wakeQueue(
    t,
    async () => {
      delivered += 1;
      return { status: 'accepted', settled: Promise.resolve() };
    },
    {
      fail: (reason) => {
        error = String(reason);
        state.paused = true;
      },
    },
  );
  for (let i = 0; i < 361; i += 1) {
    if (i) state.pending.push(message(`report-${i}`));
    queue.kick(state);
    await drain();
  }
  assert.equal(delivered, 360);
  assert.match(error, /delivery loop exceeded 360 deliveries in 5 minutes for 120 threads/);
});

test('a restart durably wakes an idle team with unfinished plan work once', async (t) => {
  const state = project();
  state.threads.push({ ...state.threads[1], appSessionId: 'child', ownerAppSessionId: 'worker' });
  state.pending = [{ ...message('child-report', 'worker'), from: 'child' }];
  state.plan = [{ id: 'step', title: 'Implement parser', state: 'doing' }];
  const h = await harness(t, [state], false);
  h.sessions.set('main', summary('main'));
  h.sessions.set('worker', summary('worker'));
  h.sessions.set('child', summary('child'));
  h.projects.historyReady();
  await drain();
  assert.equal(
    h.sent[0].id,
    'main',
    'the lead wakes before the idle parent handles its child report',
  );
  assert.match(h.sent[0].prompt, /team is idle while project work remains/);
  await h.finish('main');
  await drain();
  assert.equal(
    h.sent.filter((message) => message.id === 'main').length,
    1,
    'settling the lead alone must not loop the idle wake',
  );
});
