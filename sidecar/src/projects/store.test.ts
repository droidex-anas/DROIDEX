import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test, { type TestContext } from 'node:test';
import { fitLedger, LEDGER_LIMITS, ProjectStore, threadInputSchema } from './store.js';
import type { Project } from './types.js';
import {
  deferred,
  drain,
  harness,
  input,
  interruptedSummary,
  wakeProject,
  summary,
} from '../testing/projectServiceHarness.js';
import { ProjectService } from './ProjectService.js';
import type { SteeredReportDelivery } from '../SessionLifecycle.js';

/** The ledger path in a scratch directory removed after the test. */
async function ledgerPath(t: TestContext): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'droidex-projects-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  return join(directory, 'projects.json');
}

for (const kind of ['question', 'approval'] as const) {
  test(`a refused ${kind} waits outside a full inbox and delivers once when room opens`, async (t) => {
    const h = await harness(t);
    const ledger = new ProjectStore(await ledgerPath(t));
    const save = h.store.save.bind(h.store);
    const snapshots: Project[][] = [];
    t.mock.method(h.store, 'save', (projects: Project[]) => {
      snapshots.push(structuredClone(projects));
      return save(projects);
    });
    const validateSaves = async () => {
      for (const snapshot of snapshots.splice(0)) await ledger.save(snapshot);
      return ledger.load();
    };
    const { main } = await h.root();
    const child = await h.projects.spawn(main, input);
    const backlog = await h.projects.spawn(main, { ...input, title: 'Backlog' });
    await h.streaming(main, true);
    let delivery: SteeredReportDelivery | undefined;
    h.port.steer = async (_target, _prompt, _current, _now, callbacks) => {
      delivery = callbacks;
      callbacks?.accepted();
      return true;
    };
    if (kind === 'question') {
      await h.ask(child.appSessionId, 'request', 'Which format?', [{ label: 'JSON' }]);
    } else {
      const request = {
        kind: 'exec' as const,
        appSessionId: child.appSessionId,
        requestId: 'request',
        title: 'Run tests',
        detail: 'npm test',
        canAlwaysAllow: false,
        raw: {},
      };
      h.state.approvals.set(child.appSessionId, request);
      await h.projects.observe({ type: 'approval.requested', request });
    }
    await drain();
    assert.ok(delivery);
    assert.equal(h.state.saved[0].pending.length, 0);
    for (let index = 0; index < LEDGER_LIMITS.inbox; index += 1)
      await h.projects.send(main, backlog.appSessionId, `Task ${index}`, 'queue');
    delivery.declined('refused');
    await drain();
    assert.equal(h.projects.list()[0]?.paused, false);
    assert.equal((await validateSaves())[0]?.pending.length, LEDGER_LIMITS.inbox);
    assert.equal(h.sent.length, 0);
    await h.streaming(main, false);
    await h.finish(backlog.appSessionId, 'Backlog ready.');
    await drain();
    const delivered = () => h.sent.filter(({ prompt }) => prompt.includes(`, ${kind} request):`));
    assert.equal(delivered().length, 1);
    assert.match(
      delivered()[0].prompt,
      kind === 'question' ? /Which format\?\n- JSON/ : /npm test/,
    );
    assert.equal(h.projects.list()[0]?.paused, false);
    assert.ok((await validateSaves())[0].pending.length <= LEDGER_LIMITS.inbox);
    await h.finish(main);
    h.projects.sessionAvailable(main);
    h.projects.capacityChanged();
    await drain();
    assert.equal(delivered().length, 1);
    assert.ok((await validateSaves())[0].pending.length <= LEDGER_LIMITS.inbox);
  });
}

test('refusal drops a completed reminder but retains the rest of its batch at either inbox capacity', async (t) => {
  for (const full of [true, false]) {
    const saved = wakeProject();
    saved.threads[1].reply = 'first';
    saved.threads[1].replyId = 'reply';
    saved.pending[0].replyId = 'reply';
    saved.threads.push({
      appSessionId: 'backlog',
      ownerAppSessionId: 'main',
      title: 'Backlog',
      reply: '',
      waiting: false,
    });
    saved.todos = [{ id: 'reminder', text: 'Completed reminder', due: true, notified: true }];
    saved.pending.push({
      id: 'reminder',
      from: 'main',
      to: 'main',
      kind: 'message',
      text: 'Completed reminder',
    });
    const h = await harness(t, [saved], false);
    h.sessions.set('main', summary('main'));
    h.sessions.set('worker', summary('worker'));
    h.sessions.set('backlog', summary('backlog'));
    await h.streaming('main', true);
    await h.streaming('backlog', true);
    let delivery: SteeredReportDelivery | undefined;
    const steer = h.port.steer;
    h.port.steer = async (_target, prompt, _current, _now, callbacks) => {
      assert.match(prompt, /first/);
      assert.match(prompt, /Completed reminder/);
      delivery = callbacks;
      callbacks?.accepted();
      return true;
    };
    h.projects.historyReady();
    await drain();
    const handedOff = delivery;
    assert.ok(handedOff);
    assert.equal(h.state.saved[0].pending.length, 0);
    await h.projects.doneTodo('main', 'reminder');
    if (full)
      for (let index = 0; index < LEDGER_LIMITS.inbox; index += 1)
        await h.projects.send('main', 'backlog', `Task ${index}`, 'queue');
    assert.doesNotThrow(() => handedOff.declined('refused'));
    await drain();
    const retained = h.state.saved[0];
    assert.equal(retained.paused, false);
    assert.deepEqual(retained.todos, []);
    assert.equal(
      retained.pending.some((message) => message.id === 'reminder'),
      false,
    );
    if (full) assert.deepEqual(retained.threads[1].owedReport, { text: 'first', replyId: 'reply' });
    else assert.deepEqual(retained.pending, [saved.pending[0]]);
    const ledger = new ProjectStore(await ledgerPath(t));
    await ledger.save(h.state.saved);
    assert.deepEqual(await ledger.load(), h.state.saved);
    h.port.steer = steer;
    await h.streaming('main', false);
    if (full) await h.finish('backlog', 'Backlog ready.');
    await drain();
    const reports = () => h.sent.filter(({ prompt }) => prompt.includes('):\nfirst'));
    assert.equal(reports().length, 1);
    assert.ok(h.sent.every(({ prompt }) => !prompt.includes('Completed reminder')));
    await h.finish('main');
    h.projects.sessionAvailable('main');
    h.projects.capacityChanged();
    await drain();
    assert.equal(reports().length, 1);
  }
});

test('a new question at a full inbox persists bounded and delivers once when room opens', async (t) => {
  const h = await harness(t);
  const { main } = await h.root();
  const child = await h.projects.spawn(main, input);
  const backlog = await h.projects.spawn(main, { ...input, title: 'Backlog' });
  for (let index = 0; index < LEDGER_LIMITS.inbox; index += 1)
    await h.projects.send(main, backlog.appSessionId, `Task ${index}`, 'queue');
  await h.ask(child.appSessionId, 'new-question', 'q'.repeat(LEDGER_LIMITS.askQuestionText + 1), [
    { label: 'o'.repeat(LEDGER_LIMITS.askOptionText + 1) },
  ]);
  await drain();
  const waiting = h.state.saved[0].threads.find(
    (thread) => thread.appSessionId === child.appSessionId,
  );
  assert.ok(waiting?.ask);
  assert.equal(waiting.waiting, true);
  assert.equal(waiting.ask.requestId, 'new-question');
  assert.equal(waiting.ask.notified, undefined);
  assert.deepEqual(waiting.ask.questions, [
    {
      index: 0,
      question: 'q'.repeat(LEDGER_LIMITS.askQuestionText),
      options: ['o'.repeat(LEDGER_LIMITS.askOptionText)],
    },
  ]);
  assert.equal(h.projects.list()[0].paused, false);
  assert.equal(h.state.saved[0].pending.length, LEDGER_LIMITS.inbox);
  assert.equal(h.sent.length, 0);
  const ledger = new ProjectStore(await ledgerPath(t));
  await ledger.save(h.state.saved);
  assert.deepEqual(await ledger.load(), h.state.saved);
  await h.finish(backlog.appSessionId, 'Backlog ready.');
  await drain();
  const questions = () =>
    h.sent.filter(({ prompt }) => prompt.includes(', question new-question):'));
  assert.equal(questions().length, 1);
  assert.ok(questions()[0].prompt.includes(waiting.ask.questions[0].question));
  await h.projects.answer(main, child.appSessionId, 'new-question', ['JSON']);
  assert.equal(h.answered.length, 1);
  await h.finish(main);
  h.projects.sessionAvailable(main);
  h.projects.capacityChanged();
  await drain();
  assert.equal(questions().length, 1);
  await ledger.save(h.state.saved);
  assert.deepEqual(await ledger.load(), h.state.saved);
});

function project(): Project {
  return {
    id: 'project',
    title: 'Example',
    paused: false,
    launching: 0,
    plan: [],
    todos: [],
    threads: [{ appSessionId: 'main', title: 'Main', reply: '', waiting: false }],
    pending: [],
  };
}

test('a missing ledger is empty, writes are ordered, and a fresh reader restores the last snapshot', async (t) => {
  const path = await ledgerPath(t);
  const store = new ProjectStore(path);
  assert.deepEqual(await store.load(), []);
  const first = project();
  const one = store.save([first]);
  first.title = 'Second';
  first.paused = true;
  first.leadStopped = true;
  const two = store.save([first]);
  await Promise.all([one, two]);
  const [loaded] = await new ProjectStore(path).load();
  assert.equal(loaded?.title, 'Second');
  // A lead Stop survives restart until the user continues it.
  assert.equal(loaded?.leadStopped, true);
  if (process.platform !== 'win32') assert.equal((await stat(path)).mode & 0o777, 0o600);
});

test('a ledger past its budget sheds the oldest replies first and still saves', async (t) => {
  const path = await ledgerPath(t);
  const reply = 'x'.repeat(LEDGER_LIMITS.text);
  // Fifteen projects whose nine threads each hold every reply the ledger keeps.
  const projects: Project[] = Array.from({ length: 15 }, (_, index) => ({
    ...project(),
    id: `project-${String(index)}`,
    threads: [
      { appSessionId: `main-${String(index)}`, title: 'Main', reply: '', waiting: false },
      ...Array.from({ length: 9 }, (_, position) => ({
        appSessionId: `thread-${String(index * 9 + position)}`,
        ownerAppSessionId: `main-${String(index)}`,
        title: 'Thread',
        reply,
        earlierReplies: Array.from({ length: LEDGER_LIMITS.earlierReplies }, () => reply),
        waiting: false,
      })),
    ],
  }));
  const store = new ProjectStore(path);
  await assert.rejects(store.save(projects), /exceeds 8 MiB/);

  // A higher number moved more recently.
  fitLedger(projects, (appSessionId) => Number(appSessionId.split('-')[1]));
  await store.save(projects);
  const threads = (await new ProjectStore(path).load()).flatMap((item) => item.threads);
  const oldest = threads.find((thread) => thread.appSessionId === 'thread-0');
  assert.equal(oldest?.earlierReplies, undefined);
  assert.equal(oldest?.reply, reply);
  const newest = threads.find((thread) => thread.appSessionId === 'thread-134');
  assert.equal(newest?.earlierReplies?.length, LEDGER_LIMITS.earlierReplies);
});

test('a thread whose final reply was shed says so after a reload', async (t) => {
  const path = await ledgerPath(t);
  const reply = 'x'.repeat(LEDGER_LIMITS.text);
  // Final replies alone past the budget, with no earlier replies left to shed.
  const projects: Project[] = [
    {
      ...project(),
      threads: [
        { appSessionId: 'main', title: 'Main', reply: '', waiting: false },
        ...Array.from({ length: 800 }, (_, position) => ({
          appSessionId: `thread-${String(position)}`,
          ownerAppSessionId: 'main',
          title: 'Thread',
          reply,
          waiting: false,
        })),
      ],
    },
  ];
  fitLedger(projects, (appSessionId) => Number(appSessionId.split('-')[1] ?? -1));
  await new ProjectStore(path).save(projects);
  const threads = (await new ProjectStore(path).load()).flatMap((item) => item.threads);
  const oldest = threads.find((thread) => thread.appSessionId === 'thread-0');
  assert.equal(oldest?.reply, '');
  assert.equal(oldest?.repliesShed, true);
  const newest = threads.find((thread) => thread.appSessionId === 'thread-799');
  assert.equal(newest?.reply, reply);
  assert.equal(newest?.repliesShed, undefined);
  // The lead stores no reply, so it has none to shed.
  assert.equal(threads.find((thread) => thread.appSessionId === 'main')?.repliesShed, undefined);
});

test('corrupt ledgers, unknown owners, duplicates, cycles and foreign targets are refused, and a renderer cannot name an owner', async (t) => {
  const path = await ledgerPath(t);
  const store = new ProjectStore(path);
  // Corruption is reported without overwriting the user's saved data.
  await writeFile(path, '{broken');
  await assert.rejects(store.load());
  assert.equal(await readFile(path, 'utf8'), '{broken');

  const duplicate = project();
  await writeFile(path, JSON.stringify([duplicate, { ...duplicate, id: 'other' }]));
  await assert.rejects(store.load(), /multiple projects/);
  const unknown = project();
  unknown.threads.push({
    appSessionId: 'child',
    ownerAppSessionId: 'missing',
    title: 'Child',
    reply: '',
    waiting: false,
  });
  await writeFile(path, JSON.stringify([unknown]));
  await assert.rejects(store.load(), /ownership/);
  const cycle = project();
  cycle.threads.push({
    appSessionId: 'child',
    ownerAppSessionId: 'child',
    title: 'Child',
    reply: '',
    waiting: false,
  });
  await writeFile(path, JSON.stringify([cycle]));
  await assert.rejects(store.load(), /ownership/);
  const foreign = project();
  foreign.pending.push({
    id: 'message',
    from: 'main',
    to: 'other',
    kind: 'question',
    text: 'Question',
  });
  await writeFile(path, JSON.stringify([foreign]));
  await assert.rejects(store.load(), /target/);

  const input = { title: 'Task', prompt: 'Work', provider: 'droid', autonomy: 'low' };
  assert.equal(
    threadInputSchema.safeParse({ ...input, ownerAppSessionId: 'spoofed' }).success,
    false,
  );
});

test('to-dos and queued spawns restore, while v1.3.8 ledgers and stale to-do links still load', async (t) => {
  const path = await ledgerPath(t);
  const saved = project();
  saved.brief = 'Goal, scope, out of scope, done criteria and authority.';
  saved.lastStepId = 5;
  saved.plan = [{ id: '5', title: 'Review', state: 'review' }];
  saved.todos = [
    { id: 'todo', text: 'Review', after: 'main', dueAt: 123, due: true, notified: true },
  ];
  const store = new ProjectStore(path);
  await store.save([saved]);
  const loaded = (await store.load())[0];
  assert.deepEqual(loaded?.todos, saved.todos);
  assert.equal(loaded?.brief, saved.brief);
  assert.equal(loaded?.lastStepId, 5);
  assert.equal(loaded?.plan[0]?.state, 'review');
  const older = {
    id: saved.id,
    title: saved.title,
    paused: saved.paused,
    launching: saved.launching,
    plan: saved.plan,
    threads: saved.threads,
    pending: saved.pending,
  };
  await writeFile(path, JSON.stringify([older]));
  assert.deepEqual(await store.load(), [{ ...older, todos: [] }]);
  saved.threads.push({
    appSessionId: 'queued',
    ownerAppSessionId: 'main',
    title: 'Worker',
    reply: '',
    waiting: false,
    queuedSpawn: {
      phase: 'queued',
      input: { title: 'Worker', prompt: 'Build the parser', provider: 'droid', autonomy: 'low' },
      order: 1,
    },
  });
  await store.save([saved]);
  assert.deepEqual(await store.load(), [saved]);
  await writeFile(
    path,
    JSON.stringify([{ ...saved, todos: [{ id: 'todo', text: 'Review', after: 'gone' }] }]),
  );
  assert.deepEqual((await store.load())[0]?.todos, [{ id: 'todo', text: 'Review' }]);
});

test('a main-shaped ledger loads string owed reports and saves the canonical report shape', async (t) => {
  const path = await ledgerPath(t);
  const saved = {
    id: 'project',
    title: 'Example',
    paused: true,
    leadStopped: true,
    launching: 0,
    threads: [
      { appSessionId: 'main', title: 'Main', reply: '', waiting: false },
      {
        appSessionId: 'worker',
        ownerAppSessionId: 'main',
        title: 'Worker',
        reply: 'Latest reply',
        earlierReplies: ['Earlier reply'],
        owedReport: 'Report waiting for inbox room',
        waiting: false,
      },
    ],
    pending: [{ id: 'note', from: 'main', to: 'worker', kind: 'message', text: 'Continue' }],
    delivery: {
      state: 'uncertain',
      messages: [{ id: 'report', from: 'worker', to: 'main', kind: 'result', text: 'Done' }],
    },
  };
  await writeFile(path, JSON.stringify([saved]));
  const store = new ProjectStore(path);
  const loaded = await store.load();
  assert.deepEqual(loaded, [
    {
      ...saved,
      plan: [],
      todos: [],
      threads: [
        saved.threads[0],
        { ...saved.threads[1], owedReport: { text: saved.threads[1].owedReport } },
      ],
    },
  ]);
  await store.save(loaded);
  assert.deepEqual(await new ProjectStore(path).load(), loaded);
  assert.deepEqual(JSON.parse(await readFile(path, 'utf8')), loaded);
});

test('a refused report waits outside a full inbox, persists and delivers when room opens', async (t) => {
  const store = new ProjectStore(await ledgerPath(t));
  const saved = wakeProject();
  saved.pending = [];
  await store.save([saved]);
  const h = await harness(t, [], false);
  h.projects.close();
  h.sessions.set('main', summary('main'));
  h.sessions.set('worker', summary('worker'));
  const reportSaved = deferred();
  const projects = await ProjectService.open(h.port, store, (event) => {
    h.events.push(event);
    if (h.steered.some(({ prompt }) => prompt.includes('Retain this report.')))
      reportSaved.resolve();
  });
  t.after(() => projects.close());
  t.mock.method(h.projects, 'observe', projects.observe.bind(projects));
  const refusal = deferred<boolean>();
  const steer = h.port.steer;
  h.port.steer = async (_target, _prompt, _current, _now, delivery) => {
    delivery?.accepted();
    void refusal.promise.then((accepted) => {
      if (!accepted) delivery?.declined('refused');
    });
    return true;
  };
  await h.streaming('main', true);
  await h.streaming('worker', true);
  projects.historyReady();
  await h.finish('worker', 'Retain this report.');
  await drain();
  await projects.flush();
  assert.equal((await store.load())[0].pending.length, 0);
  h.state.capacity = 'busy';
  for (let index = 0; index < LEDGER_LIMITS.inbox; index += 1)
    await projects.send('main', 'worker', `Task ${index}`, 'queue');
  await drain();

  refusal.resolve(false);
  await drain();
  await projects.flush();
  const [retained] = await store.load();
  const worker = retained.threads.find((thread) => thread.appSessionId === 'worker');
  assert.equal(retained.pending.length, LEDGER_LIMITS.inbox);
  assert.equal(projects.list()[0].queued, LEDGER_LIMITS.inbox);
  assert.deepEqual(worker?.owedReport, { text: 'Retain this report.', replyId: worker?.replyId });
  assert.equal(retained.paused, false);
  await projects.resume('main');
  assert.equal((await store.load())[0].paused, false);

  h.port.steer = steer;
  h.state.capacity = 'free';
  projects.capacityChanged();
  await reportSaved.promise;
  const reports = h.steered.filter(({ prompt }) => prompt.includes('Retain this report.'));
  assert.equal(reports.length, 1);
  const [delivered] = await store.load();
  assert.equal(
    delivered.threads.find((thread) => thread.appSessionId === 'worker')?.owedReport,
    undefined,
  );
  assert.ok(delivered.pending.length <= LEDGER_LIMITS.inbox);
});

test('workspace-free spawns persist at either capacity and a failed spawn holds only its project', async (t) => {
  const store = new ProjectStore(await ledgerPath(t));
  const h = await harness(t, [], false);
  h.projects.close();
  h.sessions.set('free', { ...summary('free'), cwd: '' });
  h.sessions.set('other', summary('other'));
  const projects = await ProjectService.open(h.port, store, () => undefined);
  t.after(() => projects.close());
  t.mock.method(h.projects, 'observe', projects.observe.bind(projects));
  await projects.setPlan('free', [{ title: 'Build' }]);
  await projects.setPlan('other', [{ title: 'Unrelated work' }]);

  const started = await projects.spawn('free', { ...input, title: 'Started' });
  assert.equal(started.delivery, 'started');
  assert.equal(Object.hasOwn(h.launched[0], 'cwd'), false);
  h.state.capacity = 'busy';
  const queued = await projects.spawn('free', { ...input, title: 'Queued' });
  assert.equal(queued.delivery, 'queued');
  const loaded = await store.load();
  const saved = loaded
    .flatMap((project) => project.threads)
    .find((thread) => thread.appSessionId === queued.appSessionId);
  assert.ok(saved?.queuedSpawn);
  assert.equal(Object.hasOwn(saved.queuedSpawn.input, 'cwd'), false);
  assert.ok(loaded.every((project) => !project.paused));

  const write = store.save.bind(store);
  t.mock.method(store, 'save', async (value: Project[]) => {
    if (value.some((project) => project.threads.some((thread) => thread.title === 'Refused')))
      throw new Error('Write refused');
    await write(value);
  });
  await assert.rejects(projects.spawn('free', { ...input, title: 'Refused' }), /Write refused/);
  const afterFailure = await store.load();
  const failed = afterFailure.find((project) => project.threads[0]?.appSessionId === 'free');
  const unrelated = afterFailure.find((project) => project.threads[0]?.appSessionId === 'other');
  assert.equal(failed?.paused, true);
  assert.match(failed?.error ?? '', /Write refused/);
  assert.equal(unrelated?.paused, false);
  assert.equal(unrelated?.error, undefined);
  assert.equal(
    failed?.threads.some((thread) => thread.title === 'Refused'),
    false,
  );
});

test('a maximal queued task with checkout instructions survives a ledger reload intact', async (t) => {
  const path = await ledgerPath(t);
  const h = await harness(t, [], false);
  h.sessions.set('ordinary', summary('ordinary'));
  const original = await h.projects.spawn('ordinary', { ...input, title: 'Original' });
  await h.finish(original.appSessionId);
  h.state.capacity = 'busy';
  const prompt = 'x'.repeat(LEDGER_LIMITS.text);
  const queued = await h.projects.spawn('ordinary', {
    ...input,
    title: 'Review',
    prompt,
    workspaceOf: original.appSessionId,
  });
  await new ProjectStore(path).save(h.state.saved);
  const loaded = await new ProjectStore(path).load();
  const recovered = await harness(t, loaded, false);
  recovered.sessions.set('ordinary', summary('ordinary'));
  recovered.sessions.set(original.appSessionId, summary(original.appSessionId));
  recovered.projects.historyReady();
  await drain();
  const launched = recovered.launched.find((selection) => selection.title === 'Review');
  assert.ok(launched);
  assert.ok(launched.prompt.includes(prompt));
  assert.match(launched.prompt, /Work in \/workspace, where that work was done\./);
  assert.equal(recovered.sessions.get(queued.appSessionId)?.cwd, '/workspace');
});

test('user and lead Stop survive another held restart without continuing the worker', async (t) => {
  const store = new ProjectStore(await ledgerPath(t));
  for (const stop of ['user', 'lead']) {
    const original = await harness(t);
    const { id, main } = await original.root();
    const worker = await original.projects.spawn(main, { ...input, provider: 'codex' });
    await original.projects.setPaused(id, true);
    original.projects.close();

    const restored = await harness(t, original.state.saved, false);
    restored.sessions.set(main, summary(main));
    restored.sessions.set(worker.appSessionId, {
      ...interruptedSummary(worker.appSessionId),
      provider: 'codex',
    });
    restored.projects.historyReady();
    await drain();
    if (stop === 'user') await restored.projects.userStopped(worker.appSessionId);
    else await restored.projects.stop(main, worker.appSessionId);
    await store.save(restored.state.saved);
    restored.projects.close();

    const restarted = await harness(t, await store.load(), false);
    restarted.sessions.set(main, summary(main));
    const stopped = restored.sessions.get(worker.appSessionId);
    assert.ok(stopped);
    restarted.sessions.set(worker.appSessionId, { ...stopped });
    restarted.projects.historyReady();
    await drain();
    await restarted.projects.setPaused(id, false);
    await drain();
    assert.equal(restarted.sent.filter(({ id }) => id === worker.appSessionId).length, 0, stop);
    assert.equal(restarted.sessions.get(worker.appSessionId)?.streaming, false);

    await restarted.projects.send(main, worker.appSessionId, 'Run explicitly.');
    await drain();
    assert.equal(restarted.sent.filter(({ id }) => id === worker.appSessionId).length, 1);
  }
});

test('a queued task bound before dispatch survives restart and starts exactly once', async (t) => {
  const store = new ProjectStore(await ledgerPath(t));
  const h = await harness(t, [], false);
  const { main } = await h.root();
  h.state.capacity = 'busy';
  const queued = await h.projects.spawn(main, { ...input, title: 'Queued work' });
  const firstTurn = deferred();
  t.after(() => firstTurn.resolve());
  h.state.firstTurnGate = firstTurn.promise;
  const create = h.port.create;
  const openings: Promise<unknown>[] = [];
  h.port.create = async (selection, bind, clientRef, appSessionId, start) => {
    assert.ok(appSessionId);
    const bound = deferred();
    openings.push(
      create(
        selection,
        async (session) => {
          await bind(session);
          bound.resolve();
        },
        clientRef,
        appSessionId,
        start,
      ),
    );
    await bound.promise;
    return h.sessions.get(appSessionId);
  };
  h.state.capacity = 'free';
  h.projects.historyReady();
  await drain();
  assert.equal(openings.length, 1, 'a bound runtime awaiting dispatch is not opened again');
  const boundSession = h.sessions.get(queued.appSessionId);
  assert.ok(boundSession && !boundSession.streaming);
  await store.save(h.state.saved);
  h.projects.close();
  firstTurn.resolve();
  await Promise.all(openings);

  const recovered = await harness(t, await store.load(), false);
  recovered.sessions.set(main, summary(main));
  // Restart adoption restores the provider idle, even if the abandoned turn later starts.
  recovered.sessions.set(queued.appSessionId, {
    ...boundSession,
    streaming: false,
    phase: 'paused',
  });
  recovered.projects.historyReady();
  await drain();
  recovered.projects.capacityChanged();
  recovered.projects.sessionAvailable(queued.appSessionId);
  await drain();
  const launches = recovered.launched.filter(({ title }) => title === 'Queued work');
  assert.equal(launches.length, 0, 'recovery must reuse the bound provider');
  const deliveries = recovered.sent.filter(({ id }) => id === queued.appSessionId);
  assert.equal(deliveries.length, 1);
  assert.ok(deliveries[0].prompt.includes(input.prompt));
  assert.equal(recovered.sessions.get(queued.appSessionId)?.streaming, true);
  await store.save(recovered.state.saved);
  const thread = (await store.load())[0]?.threads.find(
    (thread) => thread.appSessionId === queued.appSessionId,
  );
  assert.equal(thread?.queuedSpawn, undefined);
});

test('accepting a queued spawn immediately clears the durable project completion', async (t) => {
  const store = new ProjectStore(await ledgerPath(t));
  const h = await harness(t);
  const { main } = await h.root();
  await h.projects.finish(main, 'Shipped the feature.');
  assert.equal(h.projects.list()[0]?.done?.outcome, 'Shipped the feature.');
  h.state.capacity = 'busy';
  const queued = await h.projects.spawn(main, input);
  assert.equal(queued.delivery, 'queued');
  assert.equal(h.projects.list()[0]?.done, undefined);
  await store.save(h.state.saved);
  const [saved] = await store.load();
  assert.equal(saved?.done, undefined);
  assert.ok(
    saved?.threads.find((thread) => thread.appSessionId === queued.appSessionId)?.queuedSpawn,
  );
});

test('held restart interruptions survive a second restart with failed idle adoption', async (t) => {
  const saved = wakeProject();
  saved.paused = true;
  saved.pending = [];
  const first = await harness(t, [saved], false);
  first.sessions.set('main', summary('main'));
  first.sessions.set('worker', interruptedSummary('worker'));
  first.projects.historyReady();
  await drain();
  const disk = structuredClone(first.state.saved);
  first.projects.close();
  const second = await harness(t, disk, false);
  second.sessions.set('main', summary('main'));
  second.sessions.set('worker', {
    ...summary('worker'),
    phase: 'paused',
    interruptReason: 'Idle adoption failed',
  });
  second.projects.historyReady();
  await drain();
  assert.deepEqual(second.state.saved[0].interrupted, ['worker']);
  assert.equal(second.sent.length, 0);
  await second.projects.setPaused(saved.id, false);
  await drain();
  assert.equal(second.sent.filter((item) => item.id === 'worker').length, 1);
  await second.finish('worker');
  await drain();
  assert.equal(second.sent.filter((item) => item.id === 'worker').length, 1);
});
