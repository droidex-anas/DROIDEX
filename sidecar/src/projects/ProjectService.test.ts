import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test, { type TestContext } from 'node:test';
import { promisify } from 'node:util';
import { ProjectService, type ProjectPort } from './ProjectService.js';
import { LEDGER_LIMITS, type ProjectPersistence } from './store.js';
import { CHAT_BRIEF } from './threadStart.js';
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

const git = (cwd: string, args: string[]) => promisify(execFile)('git', ['-C', cwd, ...args]);

/** A repository with one commit, so a thread can be given a worktree of its own. */
async function gitRepository(t: TestContext): Promise<string> {
  const repository = await mkdtemp(join(tmpdir(), 'droidex-project-'));
  t.after(() => rm(repository, { recursive: true, force: true }));
  await git(tmpdir(), ['init', '-q', repository]);
  await git(repository, [
    ...['-c', 'user.name=Test', '-c', 'user.email=test@example.invalid'],
    ...['commit', '-q', '--allow-empty', '-m', 'Start'],
  ]);
  return repository;
}

async function harness(saved: Project[] = [], historyReady = true) {
  const sessions = new Map<string, SessionSummary>();
  const sent: { id: string; prompt: string }[] = [];
  const launched: ThreadInput[] = [];
  const events: ServerEvent[] = [];
  const state = {
    saved: structuredClone(saved),
    failSave: false,
    gate: undefined as Promise<void> | undefined,
    capacity: 'free' as 'free' | 'busy',
    catalogGate: undefined as Promise<void> | undefined,
    bindGate: undefined as Promise<void> | undefined,
    // Holds a bound thread before its first turn, while it is not streaming yet.
    firstTurnGate: undefined as Promise<void> | undefined,
    createFailure: undefined as 'before-bind' | 'after-bind' | undefined,
  };
  const answered: { id: string; requestId: string; answers: unknown[] }[] = [];
  const configured: { id: string; settings: unknown }[] = [];
  // What each session is actually blocked on, the way the harness would know.
  const asking = new Map<string, string>();
  // A delivered turn settles when its session stops streaming, as the lifecycle's does.
  const turnEnds = new Map<string, () => void>();
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
    catalog: async () => {
      if (state.catalogGate) await state.catalogGate;
      return [
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
      ];
    },
    create: async (selection, bind) => {
      const session = summary(`session-${++next}`, selection);
      sessions.set(session.appSessionId, session);
      if (state.bindGate) await state.bindGate;
      if (state.createFailure === 'before-bind') throw new Error('The harness refused to start.');
      await bind(session);
      if (state.createFailure === 'after-bind') throw new Error('The harness exited on start.');
      if (state.firstTurnGate) await state.firstTurnGate;
      launched.push(selection);
      await streaming(session.appSessionId, true);
      return session;
    },
    deliver: async (id, prompt, isCurrent) => {
      // The gate stands for the target's resume and settings, which the real
      // delivery awaits before it checks that its caller still wants it.
      if (state.gate) await state.gate;
      if (!isCurrent()) return { status: 'cancelled' };
      if (state.capacity === 'busy') return { status: 'busy', retryOn: 'capacity' };
      const session = sessions.get(id);
      if (!session || session.streaming) return { status: 'busy', retryOn: 'target' };
      sent.push({ id, prompt });
      const settled = new Promise<void>((resolve) => turnEnds.set(id, resolve));
      await streaming(id, true);
      return { status: 'accepted', settled };
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
  if (historyReady) projects.historyReady();
  async function streaming(id: string, value: boolean) {
    const session = sessions.get(id);
    assert.ok(session);
    session.streaming = value;
    // A session's updatedAt moves when its turn settles, as the lifecycle's does.
    if (!value) {
      session.updatedAt = ++clock;
      turnEnds.get(id)?.();
      turnEnds.delete(id);
    }
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
  assert.match(h.sent[0]?.prompt ?? '', /\(thread [^)]+, question ask-1\):\nWhich storage format/);
  assert.match(h.sent[0]?.prompt ?? '', /- JSON/);
  assert.equal(h.projects.list()[0]?.threads[1]?.waiting, true);

  // A blind send would sit behind the question that is blocking the thread.
  await assert.rejects(
    h.projects.send(main, child.appSessionId, 'Carry on'),
    /waiting on the question/,
  );
  // Answering must reach the waiting harness call, not the delivery queue.
  assert.equal(await h.projects.send(main, child.appSessionId, '', ['JSON'], 'ask-1'), 'answered');
  assert.equal(h.answered.at(-1)?.requestId, 'ask-1');
  assert.equal(h.projects.list()[0]?.threads[1]?.waiting, false);
  assert.equal(h.projects.list()[0]?.queued, 0);
});

test('a late answer never lands on a newer question', async (t) => {
  const h = await harness();
  t.after(() => h.projects.close());
  const { main } = await h.root();
  const child = await h.projects.spawn(main, input);
  const ask = async (requestId: string, question: string) => {
    h.asking.set(child.appSessionId, requestId);
    await h.projects.observe({
      type: 'question.requested',
      question: {
        appSessionId: child.appSessionId,
        requestId,
        questions: [{ index: 0, question, options: [] }],
      },
    });
  };
  await ask('ask-1', 'Which format?');
  assert.equal(h.projects.read(main, child.appSessionId).questionId, 'ask-1');
  // The person answers in the thread itself, and the thread asks something else.
  h.asking.delete(child.appSessionId);
  await h.streaming(child.appSessionId, true);
  await ask('ask-2', 'Delete the old files?');

  // The lead decided the first question, so its answer must not settle the second.
  await assert.rejects(
    h.projects.send(main, child.appSessionId, '', ['JSON'], 'ask-1'),
    /no longer waiting on that question/,
  );
  await assert.rejects(h.projects.send(main, child.appSessionId, '', ['yes']), /questionId/);
  assert.deepEqual(h.answered, []);
  assert.equal(await h.projects.send(main, child.appSessionId, '', ['no'], 'ask-2'), 'answered');
});

test('threads stopped on questions for their lead leave it a delivery slot', async (t) => {
  const h = await harness();
  t.after(() => h.projects.close());
  const { main } = await h.root();
  const threads = [
    (await h.projects.spawn(main, input)).appSessionId,
    (await h.projects.spawn(main, input)).appSessionId,
  ];
  for (const id of threads) await h.finish(id);
  await drain();
  await h.finish(main);
  // The lead hands both threads more work, and those two turns take both slots.
  for (const id of threads) await h.projects.send(main, id, 'Carry on.');
  await drain();
  assert.deepEqual(
    h.sent.slice(-2).map((item) => item.id),
    threads,
  );
  // Each stops on a question only the lead can answer, so neither runs anything.
  for (const [index, id] of threads.entries()) {
    h.asking.set(id, `ask-${String(index)}`);
    await h.projects.observe({
      type: 'question.requested',
      question: {
        appSessionId: id,
        requestId: `ask-${String(index)}`,
        questions: [{ index: 0, question: 'Which format?', options: [] }],
      },
    });
  }
  await drain();
  assert.equal(h.sent.at(-1)?.id, main, 'the lead is woken to answer them');
  assert.match(h.sent.at(-1)?.prompt ?? '', /Which format/);
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

test('stopping a chat while its first thread starts cancels that spawn', async (t) => {
  const h = await harness();
  t.after(() => h.projects.close());
  h.sessions.set('ordinary', summary('ordinary'));
  const gate = deferred();
  h.state.bindGate = gate.promise;
  const spawning = h.projects.spawn('ordinary', input);
  await tick();
  await h.projects.userStopped('ordinary');
  gate.resolve();
  await assert.rejects(spawning, /cancelled/);
  await drain();
  assert.equal(h.launched.length, 0);
  assert.equal(h.state.saved.length, 0);
  assert.equal(h.sent.length, 0);

  // The Stop cancelled that spawn only; the chat's next one starts unheld.
  h.state.bindGate = undefined;
  await h.projects.spawn('ordinary', input);
  assert.equal(h.state.saved[0]?.paused, false);
});

test('threads started together each get a checkout of their own', async (t) => {
  const repository = await gitRepository(t);
  const h = await harness();
  t.after(() => h.projects.close());
  h.sessions.set('ordinary', summary('ordinary', { ...input, cwd: repository }));
  const spawn = (title: string) => h.projects.spawn('ordinary', { ...input, title });
  // A start that fails gives the checkout back.
  h.state.createFailure = 'before-bind';
  await assert.rejects(spawn('Refused'), /refused to start/);
  h.state.createFailure = undefined;

  // Two spawns made together, then a third once they are bound but not yet working.
  const gate = deferred();
  h.state.firstTurnGate = gate.promise;
  const together = [spawn('Parser'), spawn('Lexer')];
  await drain();
  const later = spawn('Printer');
  await drain();
  gate.resolve();
  const [parser, lexer, printer] = await Promise.all([...together, later]);
  assert.equal(parser?.cwd, undefined, 'the first shares the checkout');
  assert.ok(lexer?.branch, 'a thread started beside it gets its own worktree');
  assert.ok(printer?.branch, 'so does one started before either reports working');
  assert.notEqual(lexer.cwd, printer.cwd);
});

test('stopping a chat while its spawn resolves the model cancels that spawn', async (t) => {
  const h = await harness();
  t.after(() => h.projects.close());
  h.sessions.set('ordinary', summary('ordinary'));
  const named = { ...input, modelId: 'droid-core' };
  // No project exists yet for the Stop to hold, and neither kind of spawn has
  // one: a thread's first spawn and a chat started without reportBack.
  for (const start of [
    () => h.projects.spawn('ordinary', named),
    () => h.projects.startChat('ordinary', named),
  ]) {
    const catalog = deferred();
    h.state.catalogGate = catalog.promise;
    const spawning = start();
    await tick();
    await h.projects.userStopped('ordinary');
    catalog.resolve();
    await assert.rejects(spawning, /cancelled/);
  }
  assert.equal(h.launched.length, 0);
  assert.deepEqual(h.projects.list(), []);

  // The Stop cancelled those spawns only.
  h.state.catalogGate = undefined;
  await h.projects.spawn('ordinary', named);
  assert.equal(h.state.saved[0]?.paused, false);
});

test('stopping a thread while its own spawn cuts a checkout cancels that spawn', async (t) => {
  const repository = await gitRepository(t);
  const h = await harness();
  t.after(() => h.projects.close());
  h.sessions.set('ordinary', summary('ordinary', { ...input, cwd: repository }));
  const thread = await h.projects.spawn('ordinary', input);
  // The user stops the thread once its spawn is past its settings and choosing a checkout.
  const get = h.port.get;
  h.port.get = (id) => {
    if (id === thread.appSessionId && h.projects.list()[0]?.launching) {
      h.port.get = get;
      void h.projects.userStopped(thread.appSessionId);
    }
    return get(id);
  };
  await assert.rejects(
    h.projects.spawn(thread.appSessionId, { ...input, title: 'Nested', workspace: 'worktree' }),
    /cancelled/,
  );
  assert.equal(h.launched.length, 1, 'only the thread itself started');
  // The worktree cut for the cancelled spawn is taken back, branch and all.
  const { stdout: branches } = await git(repository, ['branch', '--list', 'thread/*']);
  assert.equal(branches.trim(), '');
  const { stdout: worktrees } = await git(repository, ['worktree', 'list', '--porcelain']);
  assert.equal(worktrees.match(/^worktree /gm)?.length, 1);
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

test('a delivery withdrawn before dispatch holds nothing and keeps what is still wanted', async (t) => {
  const h = await harness();
  t.after(() => h.projects.close());
  const { id, main } = await h.root();
  const reporter = await h.projects.spawn(main, input);
  const asker = await h.projects.spawn(main, input);
  const gate = deferred();
  h.state.gate = gate.promise;
  // A report and a question are claimed together for the lead.
  await h.finish(reporter.appSessionId, 'Parsed the config.');
  h.asking.set(asker.appSessionId, 'ask');
  await h.projects.observe({
    type: 'question.requested',
    question: {
      appSessionId: asker.appSessionId,
      requestId: 'ask',
      questions: [{ index: 0, question: 'Which format?', options: [] }],
    },
  });
  await tick();
  // While the lead's setup is awaited, the question is withdrawn and the user
  // stops the lead: no turn was dispatched, so nothing is uncertain.
  await h.projects.observe({
    type: 'interaction.cancelled',
    appSessionId: asker.appSessionId,
    requestId: 'ask',
  });
  await h.projects.userStopped(main);
  gate.resolve();
  await drain();
  const project = h.projects.list()[0];
  assert.equal(project?.uncertain, 0);
  assert.equal(project?.error, undefined);
  assert.equal(project?.queued, 1, 'the report waits; the withdrawn question is gone');

  await h.projects.setPaused(id, false);
  await drain();
  assert.match(h.sent.at(-1)?.prompt ?? '', /Parsed the config/);
  assert.doesNotMatch(h.sent.at(-1)?.prompt ?? '', /Which format/);
});

test('a question the thread replaced during admission never reaches the owner', async (t) => {
  const h = await harness();
  t.after(() => h.projects.close());
  const { main } = await h.root();
  const child = await h.projects.spawn(main, input);
  const ask = async (requestId: string, question: string) => {
    h.asking.set(child.appSessionId, requestId);
    await h.projects.observe({
      type: 'question.requested',
      question: {
        appSessionId: child.appSessionId,
        requestId,
        questions: [{ index: 0, question, options: [] }],
      },
    });
  };
  const gate = deferred();
  h.state.gate = gate.promise;
  await ask('ask-1', 'Which format?');
  await tick();
  // Answered in the thread while its wake waits, then a different question.
  h.asking.delete(child.appSessionId);
  await h.streaming(child.appSessionId, true);
  await ask('ask-2', 'Delete the old files?');
  gate.resolve();
  await drain();
  assert.equal(h.sent.length, 1);
  assert.doesNotMatch(h.sent[0]?.prompt ?? '', /Which format/);
  assert.match(h.sent[0]?.prompt ?? '', /question ask-2\):\nDelete the old files/);
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

test('messages a restart left queued go out once session history is ready, and not before', async (t) => {
  const h = await harness();
  t.after(() => h.projects.close());
  const { main } = await h.root();
  const child = await h.projects.spawn(main, input);
  // The lead is busy, so the thread's report is still queued when DROIDEX stops.
  await h.streaming(main, true);
  await h.finish(child.appSessionId, 'Parsed the config.');
  await drain();
  const disk = structuredClone(h.state.saved);
  assert.equal(disk[0]?.pending.length, 1);
  assert.equal(disk[0]?.delivery, undefined);

  const recovered = await harness(disk, false);
  t.after(() => recovered.projects.close());
  recovered.sessions.set(main, summary(main));
  // The lead settling would wake it, but history does not know its threads yet.
  await recovered.streaming(main, false);
  await drain();
  assert.equal(recovered.sent.length, 0);

  recovered.projects.historyReady();
  await drain();
  assert.equal(recovered.sent.at(-1)?.id, main);
  assert.match(recovered.sent.at(-1)?.prompt ?? '', /Parsed the config/);
  assert.equal(recovered.projects.list()[0]?.paused, false);
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
  await assert.rejects(underway, /cancelled/);
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
  for (const id of threads) {
    await h.finish(id, `Second from ${id}`);
    // The lead settles after every thread, so it is always the most recent,
    // yet it holds none of the eight places: nothing reads its replies back.
    await h.finish(main, 'Told the user.');
  }
  const saved = h.state.saved[0]?.threads ?? [];
  assert.equal(
    saved.filter((thread) => thread.ownerAppSessionId && thread.earlierReplies).length,
    8,
  );
  assert.equal(saved.find((thread) => thread.appSessionId === main)?.reply, '');
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

test('a chat started without reportBack belongs to no project and reports nowhere', async (t) => {
  const h = await harness();
  t.after(() => h.projects.close());
  h.sessions.set('ordinary', summary('ordinary', { ...input, title: 'Payments' }));
  const chat = await h.projects.startChat('ordinary', { ...input, prompt: 'Port the client.' });
  assert.equal(
    h.launched.at(-1)?.prompt,
    `${CHAT_BRIEF}\n\nStarted by: Payments\n\nTask:\nPort the client.`,
  );
  await h.finish(chat.appSessionId, 'Ported.');
  await drain();
  assert.equal(h.sent.length, 0);
  assert.deepEqual(h.projects.list(), []);
  assert.deepEqual(h.state.saved, []);
  // Nobody's thread, so the thread tools do not reach it.
  assert.throws(() => h.projects.read('ordinary', chat.appSessionId), /has not spawned/);
});

test('threads and started chats cannot start chats, and one chat runs at most eight', async (t) => {
  const h = await harness();
  t.after(() => h.projects.close());
  const { main } = await h.root();
  const thread = await h.projects.spawn(main, input);
  await assert.rejects(h.projects.startChat(thread.appSessionId, input), /always report back/);

  // Starts still in flight count, so a burst cannot run past the limit.
  const gate = deferred();
  h.state.bindGate = gate.promise;
  const burst = Array.from({ length: 8 }, () => h.projects.startChat(main, input));
  await assert.rejects(h.projects.startChat(main, input), /already has 8 chats/);
  gate.resolve();
  h.state.bindGate = undefined;
  const chats = await Promise.all(burst);
  await assert.rejects(h.projects.startChat(main, input), /already has 8 chats/);
  await assert.rejects(
    h.projects.startChat(chats[0]?.appSessionId ?? '', input),
    /cannot start chats of its own/,
  );
  // One that finished no longer counts.
  await h.finish(chats[0]?.appSessionId ?? '');
  await h.projects.startChat(main, input);
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
