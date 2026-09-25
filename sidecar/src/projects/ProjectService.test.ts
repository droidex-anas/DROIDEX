import assert from 'node:assert/strict';
import test from 'node:test';
import { ProjectService, type ProjectPort } from './ProjectService.js';
import { LEDGER_LIMITS, type ProjectPersistence } from './store.js';
import type { Project, ThreadInput } from './types.js';
import type { ServerEvent, SessionSummary } from '../protocol.js';

const input: ThreadInput = {
  title: 'Build',
  prompt: 'Build the feature.',
  provider: 'droid',
  autonomy: 'low',
  cwd: '/workspace',
};
const tick = () => new Promise<void>((resolve) => setImmediate(resolve));
async function drain() {
  for (let i = 0; i < 8; i += 1) await tick();
}
function deferred() {
  let resolve = () => {};
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
function summary(id: string, selection: ThreadInput = input): SessionSummary {
  return {
    appSessionId: id,
    providerSessionId: id,
    provider: selection.provider,
    sessionPurpose: 'chat',
    interactionMode: 'auto',
    role: 'user',
    title: selection.title,
    goal: selection.prompt,
    cwd: selection.cwd ?? '',
    modelId: selection.modelId,
    reasoningEffort: selection.reasoningEffort,
    autonomy: selection.autonomy,
    phase: 'running',
    streaming: false,
    features: [],
    tokensIn: 0,
    tokensOut: 0,
    contextTokens: 0,
    createdAt: 1,
    updatedAt: 1,
  };
}

async function harness(saved: Project[] = []) {
  const sessions = new Map<string, SessionSummary>();
  const sent: { id: string; prompt: string }[] = [];
  const launched: ThreadInput[] = [];
  const events: ServerEvent[] = [];
  const state = {
    saved: structuredClone(saved),
    failSave: false,
    gate: undefined as Promise<void> | undefined,
    capacity: 'free' as 'free' | 'busy',
    bindGate: undefined as Promise<void> | undefined,
    createFailure: undefined as 'before-bind' | 'after-bind' | undefined,
  };
  const answered: { id: string; requestId: string; answers: unknown[] }[] = [];
  const configured: { id: string; settings: unknown }[] = [];
  // What each session is actually blocked on, the way the harness would know.
  const asking = new Map<string, string>();
  let next = 0;
  let clock = 1;
  const store: ProjectPersistence = {
    load: async () => structuredClone(state.saved),
    save: async (value) => {
      if (state.failSave) throw new Error('Disk full');
      state.saved = structuredClone(value);
    },
  };
  const port: ProjectPort = {
    get: (id) => sessions.get(id),
    catalog: () =>
      Promise.resolve([
        {
          provider: 'droid' as const,
          readiness: 'ready' as const,
          models: [
            { id: 'droid-core', displayName: 'Droid Core', isCustom: false },
            { id: 'glm-5.3-flash', displayName: 'GLM-5.3-Flash', isCustom: false },
            {
              id: 'custom:glm-5.3-flash',
              displayName: 'GLM-5.3 Flash [Z.AI Chat Completions]',
              isCustom: true,
            },
          ],
        },
      ]),
    create: async (selection, bind) => {
      const session = summary(`session-${++next}`, selection);
      sessions.set(session.appSessionId, session);
      if (state.bindGate) await state.bindGate;
      if (state.createFailure === 'before-bind') throw new Error('The harness refused to start.');
      await bind(session);
      if (state.createFailure === 'after-bind') throw new Error('The harness exited on start.');
      launched.push(selection);
      await streaming(session.appSessionId, true);
      return session;
    },
    deliver: async (id, prompt, isCurrent) => {
      if (state.gate) await state.gate;
      if (state.capacity === 'busy') return { status: 'busy', retryOn: 'capacity' };
      const session = sessions.get(id);
      if (!isCurrent() || !session || session.streaming)
        return { status: 'busy', retryOn: 'target' };
      sent.push({ id, prompt });
      await streaming(id, true);
      return { status: 'accepted', settled: Promise.resolve() };
    },
    isAsking: (id, requestId) => asking.get(id) === requestId,
    configure: async (id, settings) => {
      const session = sessions.get(id);
      assert.ok(session);
      sessions.set(id, { ...session, ...settings });
      configured.push({ id, settings });
      await tick();
    },
    answer: (id, requestId, answers) => {
      answered.push({ id, requestId, answers });
      const live = asking.get(id) === requestId;
      asking.delete(id);
      return live;
    },
    interrupt: async (id) => {
      const session = sessions.get(id);
      if (session) session.phase = 'paused';
      await streaming(id, false);
    },
  };
  const projects = await ProjectService.open(port, store, (event) => events.push(event));
  async function streaming(id: string, value: boolean) {
    const session = sessions.get(id);
    assert.ok(session);
    session.streaming = value;
    // A session's updatedAt moves when its turn settles, as the lifecycle's does.
    if (!value) session.updatedAt = ++clock;
    await projects.observe({ type: 'session.updated', session: { ...session } });
  }
  async function finish(id: string, text = 'Done') {
    await projects.observe({
      type: 'event.appended',
      event: {
        id: `${id}-text`,
        appSessionId: id,
        sourceSessionId: id,
        role: 'primary',
        ts: 1,
        kind: 'text',
        text,
      },
    });
    await streaming(id, false);
  }
  async function root() {
    const { projectId: id, appSessionId: main } = await projects.create(input);
    assert.ok(main);
    await finish(main);
    return { id, main };
  }
  return {
    projects,
    sessions,
    sent,
    answered,
    asking,
    configured,
    launched,
    events,
    state,
    store,
    port,
    streaming,
    finish,
    root,
  };
}

test('idle projects produce no turns; one completed child wakes its owner once', async (t) => {
  const h = await harness();
  t.after(() => h.projects.close());
  const { main } = await h.root();
  await drain();
  assert.equal(h.sent.length, 0);
  const child = await h.projects.spawn(main, {
    ...input,
    provider: 'codex',
    modelId: 'code',
    reasoningEffort: 'high',
  });
  await drain();
  assert.equal(h.sent.length, 0);
  await h.finish(child.appSessionId, 'Implemented the parser.');
  await drain();
  assert.equal(h.sent.length, 1);
  assert.equal(h.sent[0]?.id, main);
  assert.match(h.sent[0]?.prompt ?? '', /Implemented the parser/);
  await h.streaming(child.appSessionId, false);
  await drain();
  assert.equal(h.sent.length, 1);
  assert.equal(h.launched[1]?.provider, 'codex');
  assert.equal(h.launched[1]?.modelId, 'code');
  assert.equal(h.launched[1]?.reasoningEffort, 'high');
  assert.equal(h.launched[1]?.cwd, '/workspace');
});

test('busy owners retain messages; sibling completions batch into one later turn', async (t) => {
  const h = await harness();
  t.after(() => h.projects.close());
  const { main } = await h.root();
  const a = await h.projects.spawn(main, input);
  const b = await h.projects.spawn(main, input);
  await h.streaming(main, true);
  await h.finish(a.appSessionId, 'A');
  await h.finish(b.appSessionId, 'B');
  await drain();
  assert.equal(h.sent.length, 0);
  assert.equal(h.projects.list()[0]?.queued, 2);
  await h.finish(main);
  await drain();
  assert.equal(h.sent.length, 1);
  // One wake, carrying both: batching them is the point, so assert the text.
  assert.match(h.sent[0]?.prompt ?? '', /\bA\b/);
  assert.match(h.sent[0]?.prompt ?? '', /\bB\b/);
  assert.equal(h.projects.list()[0]?.queued, 0);
});

test('a thread’s own question reaches its lead with its options, and the answer goes back at once', async (t) => {
  const h = await harness();
  t.after(() => h.projects.close());
  const { main } = await h.root();
  const child = await h.projects.spawn(main, input);
  h.asking.set(child.appSessionId, 'ask-1');
  await h.projects.observe({
    type: 'question.requested',
    question: {
      appSessionId: child.appSessionId,
      requestId: 'ask-1',
      questions: [{ index: 0, question: 'Which storage format?', options: ['JSON', 'SQLite'] }],
    },
  });
  await drain();
  assert.equal(h.sent.length, 1, 'the lead is woken once, with the question');
  assert.match(h.sent[0]?.prompt ?? '', /Which storage format/);
  assert.match(h.sent[0]?.prompt ?? '', /- JSON/);
  assert.equal(h.projects.list()[0]?.threads[1]?.waiting, true);

  // A blind send would sit behind the question that is blocking the thread.
  await assert.rejects(
    h.projects.send(main, child.appSessionId, 'Carry on'),
    /waiting on the question/,
  );
  // Answering must reach the waiting harness call, not the delivery queue.
  assert.equal(await h.projects.send(main, child.appSessionId, '', ['JSON']), 'answered');
  assert.equal(h.answered.at(-1)?.requestId, 'ask-1');
  assert.equal(h.projects.list()[0]?.threads[1]?.waiting, false);
  assert.equal(h.projects.list()[0]?.queued, 0);
});

test('an outsized harness question is bounded to what the ledger will load', async (t) => {
  const h = await harness();
  t.after(() => h.projects.close());
  const { main } = await h.root();
  const child = await h.projects.spawn(main, input);
  await h.projects.observe({
    type: 'question.requested',
    question: {
      appSessionId: child.appSessionId,
      requestId: 'huge',
      questions: Array.from({ length: 40 }, (_, index) => ({
        index: index + 1_000,
        question: 'q'.repeat(9_000),
        options: Array.from({ length: 40 }, () => 'o'.repeat(4_000)),
      })),
    },
  });
  // The ledger is validated on load, so a question stored past its limits would
  // refuse the whole file and take every project with it.
  const stored = h.state.saved[0]?.threads[1]?.ask;
  assert.ok(stored);
  assert.ok(stored.questions.length <= LEDGER_LIMITS.askQuestions);
  for (const item of stored.questions) {
    assert.ok(item.index <= LEDGER_LIMITS.askIndex);
    assert.ok(item.question.length <= LEDGER_LIMITS.askQuestionText);
    assert.ok(item.options.length <= LEDGER_LIMITS.askOptions);
    for (const option of item.options) assert.ok(option.length <= LEDGER_LIMITS.askOptionText);
  }
  assert.ok((h.state.saved[0]?.pending[0]?.text.length ?? 0) <= LEDGER_LIMITS.text);
});

test('a question that dies with its turn takes its wake off the queue', async (t) => {
  const h = await harness();
  t.after(() => h.projects.close());
  const { main } = await h.root();
  const child = await h.projects.spawn(main, input);
  const question = {
    appSessionId: child.appSessionId,
    requestId: 'ask-dead',
    questions: [{ index: 0, question: 'Which format?', options: ['JSON', 'SQLite'] }],
  };
  await h.projects.observe({ type: 'question.requested', question });
  assert.equal(h.projects.list()[0]?.queued, 1);

  // The turn ended before anyone answered, so the thread holds no question and
  // waking its owner to answer one would send the answer nowhere.
  await h.projects.observe({
    type: 'interaction.cancelled',
    appSessionId: child.appSessionId,
    requestId: 'ask-dead',
  });
  await drain();
  assert.equal(h.projects.list()[0]?.queued, 0);
  assert.equal(h.projects.list()[0]?.threads[1]?.waiting, false);
  assert.equal(h.sent.length, 0);
});

test('a question answered inside its thread stops asking the owner mid-turn', async (t) => {
  const h = await harness();
  t.after(() => h.projects.close());
  const { main } = await h.root();
  const child = await h.projects.spawn(main, input);
  h.asking.set(child.appSessionId, 'ask-live');
  await h.projects.observe({
    type: 'question.requested',
    question: {
      appSessionId: child.appSessionId,
      requestId: 'ask-live',
      questions: [{ index: 0, question: 'Which format?', options: ['JSON', 'SQLite'] }],
    },
  });
  assert.equal(h.projects.list()[0]?.threads[1]?.waiting, true);

  // The person answered it in the thread's own chat: no event says so, and the
  // turn carries on. The owner must stop being told to answer it.
  h.asking.delete(child.appSessionId);
  await h.streaming(child.appSessionId, true);
  await drain();
  assert.equal(h.projects.list()[0]?.threads[1]?.waiting, false);
  assert.equal(h.projects.list()[0]?.queued, 0);
});

test('a thread that settles reports either way: an empty turn, or the failure that ended it', async (t) => {
  const h = await harness();
  t.after(() => h.projects.close());
  const { main } = await h.root();
  const quiet = await h.projects.spawn(main, input);
  // A model that answers nothing must still wake its lead, or the project
  // stalls with the lead believing the thread is still working.
  await h.streaming(quiet.appSessionId, false);
  await drain();
  assert.match(h.sent.at(-1)?.prompt ?? '', /without a reply/);
  // The lead is mid-turn on that wake; its next one waits for it to settle.
  await h.finish(main);

  const broken = await h.projects.spawn(main, input);
  const session = h.sessions.get(broken.appSessionId);
  assert.ok(session);
  await h.projects.observe({
    type: 'event.appended',
    event: {
      id: 'boom',
      appSessionId: broken.appSessionId,
      sourceSessionId: broken.appSessionId,
      role: 'primary',
      ts: 1,
      kind: 'error',
      text: 'Model provider refused the request.',
      isError: true,
    },
  });
  session.phase = 'failed';
  await h.streaming(broken.appSessionId, false);
  await drain();
  assert.match(h.sent.at(-1)?.prompt ?? '', /failed before finishing/);
  assert.match(h.sent.at(-1)?.prompt ?? '', /provider refused/);
});

test('ordinary chats adopt a project, with scoped ownership and no autonomy escalation', async (t) => {
  const h = await harness();
  t.after(() => h.projects.close());
  h.sessions.set('ordinary', summary('ordinary'));
  const child = await h.projects.spawn('ordinary', input);
  const grandchild = await h.projects.spawn(child.appSessionId, input);
  const other = await h.root();
  assert.equal(h.projects.list().length, 2);
  await assert.rejects(h.projects.send(child.appSessionId, 'ordinary', 'Take over'), /owner/);
  await assert.rejects(h.projects.send('ordinary', other.main, 'Cross project'), /outside/);
  await assert.rejects(
    h.projects.spawn(child.appSessionId, { ...input, autonomy: 'high' }),
    /autonomy/,
  );
  await h.projects.send('ordinary', grandchild.appSessionId, 'Main can coordinate all members.');
});

test('a first spawn that fails leaves no project behind, wherever it failed', async (t) => {
  const h = await harness();
  t.after(() => h.projects.close());
  h.sessions.set('ordinary', summary('ordinary'));
  await assert.rejects(h.projects.spawn('ordinary', { ...input, step: '1' }), /keeps no plan yet/);
  // Its checkout cannot be cut, so nothing launches.
  await assert.rejects(
    h.projects.spawn('ordinary', { ...input, workspace: 'worktree' }),
    /no longer exists/,
  );
  h.state.createFailure = 'before-bind';
  await assert.rejects(h.projects.spawn('ordinary', input), /refused to start/);
  // Nothing before a thread binds reaches the ledger or the Projects view.
  assert.ok(
    h.events.every((event) => event.type !== 'projects.snapshot' || !event.projects.length),
  );

  // A thread that binds and then fails takes its project with it, including
  // when a parallel first spawn is still starting as the first one fails.
  h.state.createFailure = 'after-bind';
  const gate = deferred();
  h.state.bindGate = gate.promise;
  const both = [h.projects.spawn('ordinary', input), h.projects.spawn('ordinary', input)];
  gate.resolve();
  const outcomes = await Promise.allSettled(both);
  assert.ok(outcomes.every((outcome) => outcome.status === 'rejected'));
  assert.deepEqual(h.projects.list(), []);
  assert.equal(h.state.saved.length, 0);

  // The chat can still spawn, and that project holds the thread.
  h.state.createFailure = undefined;
  h.state.bindGate = undefined;
  const started = await h.projects.spawn('ordinary', input);
  assert.deepEqual(
    h.state.saved[0]?.threads.map((thread) => thread.appSessionId),
    ['ordinary', started.appSessionId],
  );
});

test('a failed spawn never removes a project started in Projects', async (t) => {
  const h = await harness();
  t.after(() => h.projects.close());
  const { main } = await h.root();
  h.state.createFailure = 'after-bind';
  await assert.rejects(h.projects.spawn(main, input), /exited on start/);
  assert.equal(h.projects.list().length, 1);
  assert.equal(h.state.saved[0]?.threads.length, 1);
});

test('pause cancels a pending wake after asynchronous admission work', async (t) => {
  const h = await harness();
  t.after(() => h.projects.close());
  const { id, main } = await h.root();
  const child = await h.projects.spawn(main, input);
  const gate = deferred();
  h.state.gate = gate.promise;
  await h.finish(child.appSessionId);
  await tick();
  await h.projects.setPaused(id, true);
  gate.resolve();
  await drain();
  assert.equal(h.sent.length, 0);
  assert.equal(h.projects.list()[0]?.queued, 1);
});

test('stop waits for a cancelled claim before removing target messages', async (t) => {
  const h = await harness();
  t.after(() => h.projects.close());
  const { main } = await h.root();
  const child = await h.projects.spawn(main, input);
  const gate = deferred();
  h.state.gate = gate.promise;
  await h.projects.send(main, child.appSessionId, 'Do not deliver after stop.');
  await tick();
  const stopped = h.projects.stop(main, child.appSessionId);
  gate.resolve();
  await stopped;
  await drain();
  assert.equal(
    h.sent.some((item) => item.id === child.appSessionId),
    false,
  );
  assert.equal(
    h.state.saved[0]?.pending.some((item) => item.to === child.appSessionId),
    false,
  );
});

test('holding a project cancels every spawn still starting before it reaches the provider', async (t) => {
  const h = await harness();
  t.after(() => h.projects.close());
  const { id, main } = await h.root();
  const gate = deferred();
  h.state.bindGate = gate.promise;
  // No count caps a project: all twelve are admitted and starting at once.
  const requests = Array.from({ length: 12 }, () => h.projects.spawn(main, input));
  await tick();
  assert.equal(h.projects.list()[0]?.launching, 12);
  await h.projects.setPaused(id, true);
  gate.resolve();
  const outcomes = await Promise.allSettled(requests);
  assert.ok(outcomes.every((result) => result.status === 'rejected'));
  assert.equal(h.launched.length, 1, 'no child goal reached the provider');
  assert.equal(h.projects.list()[0]?.launching, 0);
});

test('persistence failure fails closed without delivering a queued wake', async (t) => {
  const h = await harness();
  t.after(() => h.projects.close());
  const { main } = await h.root();
  const child = await h.projects.spawn(main, input);
  h.state.failSave = true;
  await assert.rejects(h.projects.send(main, child.appSessionId, 'Work'), /Disk full/);
  await drain();
  assert.equal(h.sent.length, 0);
  assert.equal(h.projects.list()[0]?.paused, true);
  assert.match(h.projects.list()[0]?.error ?? '', /Disk full/);
});

test('restart preserves an uncertain delivery and never replays it implicitly', async (t) => {
  const h = await harness();
  t.after(() => h.projects.close());
  const { id, main } = await h.root();
  const child = await h.projects.spawn(main, input);
  const gate = deferred();
  h.state.gate = gate.promise;
  await h.finish(child.appSessionId);
  await tick();
  const disk = structuredClone(h.state.saved);
  assert.equal(disk[0]?.delivery?.state, 'sending');
  const recovered = await harness(disk);
  t.after(() => recovered.projects.close());
  assert.equal(recovered.projects.list()[0]?.paused, true);
  assert.equal(recovered.projects.list()[0]?.uncertain, 1);
  await assert.rejects(recovered.projects.setPaused(id, false), /uncertain/);
  await recovered.projects.setPaused(id, false, true);
  await drain();
  assert.equal(recovered.sent.length, 0);
  assert.equal(recovered.projects.list()[0]?.uncertain, 0);
  h.projects.close();
  gate.resolve();
  await h.projects.flush();
});

test('work keeps flowing, and only a runaway loop holds the project', async (t) => {
  const h = await harness();
  t.after(() => h.projects.close());
  const { main } = await h.root();
  const child = await h.projects.spawn(main, input);
  const report = async (index: number) => {
    await h.streaming(child.appSessionId, true);
    await h.finish(child.appSessionId, `Result ${String(index)}`);
    await drain();
    await h.finish(main);
  };
  // Long-running work is never rationed: a project reports as often as it settles.
  for (let i = 0; i < 40; i += 1) await report(i);
  assert.equal(h.sent.length, 40);
  assert.equal(h.projects.list()[0]?.paused, false);
  // Past the pace any real turn could keep, DROIDEX holds it for a person.
  for (let i = 40; i < 62; i += 1) await report(i);
  assert.equal(h.projects.list()[0]?.paused, true);
  assert.match(h.projects.list()[0]?.error ?? '', /talking in circles/);
});

test('a released runtime unparks a delivery that was waiting for a slot', async (t) => {
  const h = await harness();
  t.after(() => h.projects.close());
  const { main } = await h.root();
  const child = await h.projects.spawn(main, input);
  // The runtime limit, not the recipient, is what turned this delivery away.
  h.state.capacity = 'busy';
  await h.finish(child.appSessionId, 'Done');
  await drain();
  assert.equal(h.sent.length, 0);
  assert.equal(h.projects.list()[0]?.queued, 1);

  // Another session closing hands its slot back; nothing else announces that.
  h.state.capacity = 'free';
  await h.projects.observe({ type: 'session.closed', appSessionId: 'someone-else' });
  await drain();
  assert.equal(h.sent.length, 1);
  assert.equal(h.projects.list()[0]?.queued, 0);
});

test('stopping one thread by hand quiets that thread, not the project', async (t) => {
  const h = await harness();
  t.after(() => h.projects.close());
  const { main } = await h.root();
  const stopped = await h.projects.spawn(main, input);
  const working = await h.projects.spawn(main, input);
  await h.projects.send(main, stopped.appSessionId, 'Drop this.');
  await h.projects.userStopped(stopped.appSessionId);
  await drain();
  assert.equal(h.projects.list()[0]?.paused, false);
  assert.equal(
    h.sent.some((item) => item.id === stopped.appSessionId),
    false,
  );
  await h.finish(working.appSessionId, 'Still reporting.');
  await drain();
  assert.equal(h.sent.at(-1)?.id, main);

  // Stopping the main thread still holds the whole project.
  await h.projects.userStopped(main);
  assert.equal(h.projects.list()[0]?.paused, true);
});

test("the main chat's next spawn lifts the hold its Stop put on, and no other hold", async (t) => {
  const h = await harness();
  t.after(() => h.projects.close());
  const { main } = await h.root();
  // A spawn already under way when the user pressed Stop does not undo it.
  const underway = h.projects.spawn(main, input);
  await h.projects.userStopped(main);
  await assert.rejects(underway, /held/);
  assert.equal(h.state.saved[0]?.leadStopped, true);

  const child = await h.projects.spawn(main, input);
  assert.equal(h.projects.list()[0]?.paused, false);
  assert.equal(h.state.saved[0]?.leadStopped, undefined);

  // A failure's hold stays the user's to lift, even after a later Stop.
  h.state.failSave = true;
  await assert.rejects(h.projects.send(main, child.appSessionId, 'Work'), /Disk full/);
  h.state.failSave = false;
  await h.projects.userStopped(main);
  await assert.rejects(h.projects.spawn(main, input), /held/);
});

test('a closed recipient unparks the delivery that waited on its turn', async (t) => {
  const h = await harness();
  t.after(() => h.projects.close());
  const { main } = await h.root();
  const child = await h.projects.spawn(main, input);
  const owner = h.sessions.get(main);
  assert.ok(owner);
  owner.streaming = true;
  await h.finish(child.appSessionId, 'Done');
  await drain();
  assert.equal(h.sent.length, 0);

  // The owner closes mid-turn, so no settlement ever frees the delivery.
  owner.streaming = false;
  await h.projects.observe({ type: 'session.closed', appSessionId: main });
  await drain();
  assert.equal(h.sent.at(-1)?.id, main);
  assert.equal(h.projects.list()[0]?.queued, 0);
});

test("permission requests and the main chat's own question stay with the user", async (t) => {
  const h = await harness();
  t.after(() => h.projects.close());
  const { main } = await h.root();
  await h.projects.observe({
    type: 'approval.requested',
    request: {
      appSessionId: main,
      requestId: 'approval',
      kind: 'exec',
      title: 'Run?',
      detail: 'A command',
      raw: {},
    },
  });
  await h.projects.observe({
    type: 'question.requested',
    question: {
      appSessionId: main,
      requestId: 'question',
      questions: [{ index: 0, question: 'User decision?', options: [] }],
    },
  });
  await drain();
  assert.equal(h.sent.length, 0);
});

test('a model named the way a chat names its own resolves to that one, not its hosted twin', async (t) => {
  const h = await harness();
  t.after(() => h.projects.close());
  const { main } = await h.root();
  const lead = h.sessions.get(main);
  assert.ok(lead);
  // The lead runs the user's own key for this model. The harness carries the
  // hosted one under the bare id too, and that one answers nothing here.
  lead.modelId = 'custom:glm-5.3-flash';
  await h.projects.spawn(main, { ...input, modelId: 'glm-5.3-flash' });
  assert.equal(h.launched.at(-1)?.modelId, 'custom:glm-5.3-flash');

  lead.modelId = 'droid-core';
  await assert.rejects(
    h.projects.spawn(main, { ...input, modelId: 'GLM-5.3 Flash' }),
    /names 2 models.*custom:glm-5\.3-flash/s,
  );
  await assert.rejects(
    h.projects.spawn(main, { ...input, modelId: 'gpt-9' }),
    /no model "gpt-9".*droid-core/s,
  );
  // An exact id says which twin, so it is never ambiguous.
  await h.projects.spawn(main, { ...input, modelId: 'custom:glm-5.3-flash' });
  assert.equal(h.launched.at(-1)?.modelId, 'custom:glm-5.3-flash');
});

test('a lead reads a thread in full and retunes it within its own autonomy', async (t) => {
  const h = await harness();
  t.after(() => h.projects.close());
  const { main } = await h.root();
  const child = await h.projects.spawn(main, input);
  await h.finish(child.appSessionId, 'x'.repeat(2_000));
  await drain();
  // The report is an excerpt; reading the thread gives the whole reply back.
  assert.match(h.sent.at(-1)?.prompt ?? '', /last 1,200 characters/);
  const read = h.projects.read(main, child.appSessionId);
  assert.deepEqual(read.replies.length, 1);
  assert.equal(read.replies[0]?.length, 2_000);
  assert.equal(read.state, 'idle');

  // A second answer keeps the first readable, and a silent turn erases neither.
  await h.finish(main);
  await h.finish(child.appSessionId, 'Second answer');
  await h.streaming(child.appSessionId, true);
  await h.streaming(child.appSessionId, false);
  await drain();
  assert.equal(h.projects.read(main, child.appSessionId).replies.at(-1), 'Second answer');
  const both = h.projects.read(main, child.appSessionId, 5);
  assert.equal(both.replies.length, 2);
  assert.equal(both.replies[0]?.length, 2_000);
  assert.equal(both.moreReplies, 0);

  const lead = h.sessions.get(main);
  assert.ok(lead);
  lead.modelId = 'custom:glm-5.3-flash';
  const tuned = await h.projects.configure(main, child.appSessionId, {
    reasoningEffort: 'low',
    modelId: 'glm-5.3-flash',
  });
  assert.equal(tuned.reasoningEffort, 'low');
  // A model name resolves the way a spawn resolves it, twin rule included.
  assert.equal(tuned.modelId, 'custom:glm-5.3-flash');
  await assert.rejects(
    h.projects.configure(main, child.appSessionId, { autonomy: 'high' }),
    /cannot exceed/,
  );
  // Reading and retuning stay inside the project, like every other control.
  assert.throws(() => h.projects.read('ordinary', child.appSessionId), /has not spawned/);
});

test('only the threads that moved most recently keep earlier replies in the ledger', async (t) => {
  const h = await harness();
  t.after(() => h.projects.close());
  const { main } = await h.root();
  const threads: string[] = [];
  for (let index = 0; index < 10; index += 1)
    threads.push((await h.projects.spawn(main, input)).appSessionId);
  for (const id of threads) await h.finish(id, `First from ${id}`);
  for (const id of threads) await h.finish(id, `Second from ${id}`);
  assert.equal(h.state.saved[0]?.threads.filter((thread) => thread.earlierReplies).length, 8);
  // The two that settled longest ago keep only their final reply.
  const oldest = h.projects.read(main, threads[0] ?? '', 5);
  assert.deepEqual(oldest.replies, [`Second from ${threads[0] ?? ''}`]);
  assert.equal(oldest.moreReplies, 0);
  assert.equal(h.projects.read(main, threads[9] ?? '', 5).replies.length, 2);
});

test("a lead cannot retune a thread's own thread past the chat that started it", async (t) => {
  const h = await harness();
  t.after(() => h.projects.close());
  const { main } = await h.root();
  const lead = h.sessions.get(main);
  assert.ok(lead);
  lead.autonomy = 'high';
  const child = await h.projects.spawn(main, { ...input, autonomy: 'low' });
  const grandchild = await h.projects.spawn(child.appSessionId, input);
  await assert.rejects(
    h.projects.configure(main, grandchild.appSessionId, { autonomy: 'medium' }),
    /chat that started it/,
  );
  await h.projects.configure(main, child.appSessionId, { autonomy: 'medium' });
  assert.equal(h.sessions.get(child.appSessionId)?.autonomy, 'medium');
});

test('a spawn carries a settled plan step, or none at all', async (t) => {
  const h = await harness();
  t.after(() => h.projects.close());
  const { main } = await h.root();
  await assert.rejects(h.projects.spawn(main, { ...input, step: 'Ship the moon' }), /no plan yet/);
  await h.projects.setPlan(main, [{ title: 'Port the payments client' }]);
  await assert.rejects(h.projects.spawn(main, { ...input, step: 'Ship the moon' }), /No plan step/);
  const started = await h.projects.spawn(main, { ...input, step: 'Port the payments client' });
  assert.equal(h.projects.list()[0]?.plan[0]?.threadAppSessionId, started.appSessionId);
});

test('an ordinary chat that writes a plan becomes a project and spawns for its steps', async (t) => {
  const h = await harness();
  t.after(() => h.projects.close());
  h.sessions.set('ordinary', summary('ordinary'));
  await assert.rejects(
    h.projects.setPlan('ordinary', [{ title: 'Port', threadAppSessionId: 'someone' }]),
    /started no threads yet/,
  );
  assert.equal(await h.projects.setPlan('ordinary', []), 0);
  assert.equal(h.projects.list().length, 0);

  await h.projects.setPlan('ordinary', [{ title: 'Port the payments client' }]);
  assert.equal(h.state.saved[0]?.plan[0]?.title, 'Port the payments client');
  const started = await h.projects.spawn('ordinary', { ...input, step: '1' });
  assert.equal(h.projects.list()[0]?.plan[0]?.threadAppSessionId, started.appSessionId);
  await assert.rejects(
    h.projects.setPlan(started.appSessionId, [{ title: 'Its own plan' }]),
    /leads a project/,
  );
});

test('a spawn keeps the plan step it named when two steps share a title', async (t) => {
  const h = await harness();
  t.after(() => h.projects.close());
  const { main } = await h.root();
  await h.projects.setPlan(main, [{ title: 'Review' }, { title: 'Review' }]);
  const started = await h.projects.spawn(main, { ...input, step: '2' });
  const plan = h.projects.list()[0]?.plan;
  assert.equal(plan?.[0]?.threadAppSessionId, undefined);
  assert.equal(plan?.[1]?.threadAppSessionId, started.appSessionId);
});

test('a question withdrawn while its wake is in flight never reaches the owner', async (t) => {
  const h = await harness();
  t.after(() => h.projects.close());
  const { main } = await h.root();
  const child = await h.projects.spawn(main, input);
  h.asking.set(child.appSessionId, 'ask');
  const gate = deferred();
  h.state.gate = gate.promise;
  await h.projects.observe({
    type: 'question.requested',
    question: {
      appSessionId: child.appSessionId,
      requestId: 'ask',
      questions: [{ index: 0, question: 'Which API?', options: [] }],
    },
  });
  // Mid-turn, but stopped on its question: the owner is told it is waiting.
  assert.equal(h.projects.read(main, child.appSessionId).state, 'waiting');
  await tick();
  await h.projects.observe({
    type: 'interaction.cancelled',
    appSessionId: child.appSessionId,
    requestId: 'ask',
  });
  gate.resolve();
  await drain();
  assert.equal(h.sent.length, 0);
  assert.equal(h.projects.list()[0]?.queued, 0);
});

test('durable project request identity avoids a duplicate root', async (t) => {
  const h = await harness();
  t.after(() => h.projects.close());
  const first = await h.projects.create(input, 'request-1');
  const repeat = await h.projects.create(input, 'request-1');
  assert.equal(first.projectId, 'request-1');
  assert.equal(repeat.projectId, 'request-1');
  // The repeat must name the same conversation, or the caller opens nothing.
  assert.ok(first.appSessionId);
  assert.equal(repeat.appSessionId, first.appSessionId);
  assert.equal(h.launched.length, 1);
});
