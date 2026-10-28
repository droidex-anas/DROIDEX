import assert from 'node:assert/strict';
import test from 'node:test';
import { CHAT_BRIEF } from './threadStart.js';
import { LEDGER_LIMITS } from './store.js';
import {
  deferred,
  drain,
  git,
  gitRepository,
  harness,
  idleProject,
  ordinaryChat,
  projectWithThread,
  input,
  summary,
  tick,
  waitForThreadStarts,
} from '../testing/projectServiceHarness.js';

test('idle projects produce no turns; one completed child wakes its owner once', async (t) => {
  const { h, main } = await idleProject(t);
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

test('running owners receive sibling reports through one steer without a competing turn', async (t) => {
  const { h, main } = await idleProject(t);
  const a = await h.projects.spawn(main, input);
  const b = await h.projects.spawn(main, input);
  const later = await h.projects.addTodo(main, { text: 'Tell the user' });
  const after = await h.projects.addTodo(main, { text: 'Review A', after: a.appSessionId });
  await h.streaming(main, true);
  await h.finish(a.appSessionId, 'A');
  await h.finish(b.appSessionId, 'B');
  await drain();
  assert.equal(h.sent.length, 0);
  assert.equal(h.steered.length, 1);
  assert.match(h.steered[0]?.prompt ?? '', /\bA\b/);
  assert.match(h.steered[0]?.prompt ?? '', /\bB\b/);
  assert.match(h.steered[0]?.prompt ?? '', /\[DUE\].*Review A/);
  assert.deepEqual(
    h.projects.listThreads(main).todos.map((todo) => todo.id),
    [after.id, later.id],
  );
  await h.finish(main);
  await drain();
  assert.equal(h.sent.length, 0);
  assert.equal(h.projects.list()[0]?.queued, 0);
});

test('a thread that settles reports either way: an empty turn, or the failure that ended it', async (t) => {
  const { h, main } = await idleProject(t);
  const quiet = await h.projects.spawn(main, input);
  // A model that answers nothing must still wake its lead, or the project
  // stalls with the lead believing the thread is still working.
  await h.streaming(quiet.appSessionId, false);
  await drain();
  assert.match(h.sent.at(-1)?.prompt ?? '', /without a reply/);
  // The lead is mid-turn on that wake; its next one waits for it to settle.
  await h.finish(main);

  const broken = await h.projects.spawn(quiet.appSessionId, input);
  await h.streaming(quiet.appSessionId, true);
  await h.fail(broken.appSessionId, 'Model provider refused the request.', { resetsAt: 2_000_000 });
  await drain();
  const failure = h.sent.slice(1).find((message) => message.id === main)?.prompt ?? '';
  assert.match(failure, /failed: Model provider refused the request/);
  assert.match(h.steered.at(-1)?.prompt ?? '', /provider refused/);
  const failed = h.projects.read(main, broken.appSessionId);
  assert.equal(failed.state, 'rate-limited');
  assert.equal(failed.resetsAt, 2_000_000);
  assert.match(failure, /Continue it with thread_send/);
  assert.match(failure, /Send again after 1970-01-01T00:33:20.000Z/);
});

test('ordinary chats adopt a project, with scoped ownership and no autonomy escalation', async (t) => {
  const h = await ordinaryChat(t);
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

  // Closing a side chat deletes it, so it never becomes the chat a project reports to.
  const lineage = { kind: 'side' as const, sourceAppSessionId: 'ordinary', forkedAt: 1 };
  h.sessions.set('side', { ...summary('side'), lineage });
  await assert.rejects(h.projects.spawn('side', input), /side chat/);
  await assert.rejects(h.projects.setPlan('side', [{ title: 'Port' }]), /side chat/);
  const owner = h.sessions.get('ordinary');
  assert.ok(owner);
  owner.autonomy = 'high';
  await h.projects.spawn('ordinary', { title: 'Default autonomy', prompt: 'Work' });
  assert.equal(h.launched.at(-1)?.autonomy, 'high');
  assert.equal(h.projects.list().length, 2);
});

test('a first spawn that fails leaves no project behind, wherever it failed', async (t) => {
  const h = await ordinaryChat(t);
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

test('threads started together each get a checkout of their own', async (t) => {
  const repository = await gitRepository(t);
  const h = await ordinaryChat(t, { ...input, cwd: repository });
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

test('queued spawns reserve their checkouts until they launch or are cancelled', async (t) => {
  const repository = await gitRepository(t);
  const h = await harness(t, [], false);
  h.sessions.set('ordinary', summary('ordinary', { ...input, cwd: repository }));
  h.state.capacity = 'busy';
  const first = await h.projects.spawn('ordinary', { ...input, title: 'Parser' });
  const second = await h.projects.spawn('ordinary', { ...input, title: 'Lexer' });
  assert.equal(first.delivery, 'queued');
  assert.equal(second.delivery, 'queued');
  const secondCheckout = h.state.saved[0]?.threads.find(
    (thread) => thread.appSessionId === second.appSessionId,
  )?.queuedSpawn?.input.cwd;
  assert.notEqual(secondCheckout, repository);
  h.state.capacity = 'free';
  const firstTurn = deferred();
  h.state.firstTurnGate = firstTurn.promise;
  h.projects.historyReady();
  await drain();
  const third = await h.projects.spawn('ordinary', { ...input, title: 'Printer' });
  const thirdCheckout = h.state.saved[0]?.threads.find(
    (thread) => thread.appSessionId === third.appSessionId,
  )?.queuedSpawn?.input.cwd;
  assert.notEqual(thirdCheckout, repository, 'binding does not release a starting checkout');
  firstTurn.resolve();
  await drain();
  assert.equal(h.sessions.get(first.appSessionId)?.cwd, repository);
  assert.equal(h.sessions.get(second.appSessionId)?.cwd, secondCheckout);
  assert.equal(
    h.state.saved[0]?.threads.some((thread) => thread.queuedSpawn),
    false,
  );
  await h.projects.stop('ordinary', first.appSessionId);
  await h.projects.stop('ordinary', second.appSessionId);
  await h.projects.stop('ordinary', third.appSessionId);
  h.state.capacity = 'busy';
  const cancelled = await h.projects.spawn('ordinary', { ...input, title: 'Cancelled' });
  await h.projects.stop('ordinary', cancelled.appSessionId);
  const replacement = await h.projects.spawn('ordinary', { ...input, title: 'Replacement' });
  const checkout = h.state.saved[0]?.threads.find(
    (thread) => thread.appSessionId === replacement.appSessionId,
  )?.queuedSpawn?.input.cwd;
  assert.equal(checkout, repository);
});

test('stopping a chat while its first spawn starts cancels that spawn, and only that one', async (t) => {
  const h = await ordinaryChat(t);
  const named = { ...input, modelId: 'droid-core' };
  // No project exists yet for the Stop to hold. The spawn is caught while its
  // thread binds or while it resolves the model, for a thread's first spawn and
  // for a chat started without reportBack.
  for (const [gate, start] of [
    ['bindGate', () => h.projects.spawn('ordinary', input)],
    ['catalogGate', () => h.projects.spawn('ordinary', named)],
    ['catalogGate', () => h.projects.startChat('ordinary', named)],
  ] as const) {
    const held = deferred();
    h.state[gate] = held.promise;
    const spawning = start();
    await tick();
    await h.projects.userStopped('ordinary');
    held.resolve();
    await assert.rejects(spawning, /cancelled/);
    h.state[gate] = undefined;
  }
  await drain();
  assert.equal(h.launched.length, 0);
  assert.deepEqual(h.projects.list(), []);
  assert.equal(h.state.saved.length, 0);
  assert.equal(h.sent.length, 0);

  // The Stop cancelled those spawns only; the chat's next one starts unheld.
  await h.projects.spawn('ordinary', named);
  assert.equal(h.state.saved[0]?.paused, false);
});

test('stopping a thread while its own spawn cuts a checkout cancels that spawn', async (t) => {
  const repository = await gitRepository(t);
  const h = await ordinaryChat(t, { ...input, cwd: repository });
  const thread = await h.projects.spawn('ordinary', input);
  // The user stops the thread once its spawn is past its settings and choosing a checkout.
  const get = h.port.get;
  h.port.get = (id) => {
    const intercepted = h.port.get;
    h.port.get = get;
    if (id === thread.appSessionId && h.projects.list()[0]?.launching) {
      void h.projects.userStopped(thread.appSessionId);
    } else h.port.get = intercepted;
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
  const { h, main } = await idleProject(t);
  h.state.createFailure = 'after-bind';
  await assert.rejects(h.projects.spawn(main, input), /exited on start/);
  assert.equal(h.projects.list().length, 1);
  assert.equal(h.state.saved[0]?.threads.length, 1);
});

test('pause cancels a pending wake after asynchronous admission work', async (t) => {
  const { h, id, main, child } = await projectWithThread(t);
  const running = await h.projects.spawn(main, { ...input, title: 'Running' });
  const gate = deferred();
  h.state.gate = gate.promise;
  await h.projects.stop(main, child.appSessionId);
  await tick();
  await h.projects.setPaused(id, true);
  gate.resolve();
  await drain();
  assert.equal(h.sent.length, 0);
  assert.deepEqual(h.state.saved[0].interrupted, [running.appSessionId]);
  const resumed = await h.projects.resume(main);
  assert.deepEqual(resumed.resumed, [running.appSessionId]);
  await drain();
  assert.ok(h.sent.some((message) => message.id === running.appSessionId));
  assert.equal(
    h.sent.some((message) => message.id === child.appSessionId),
    false,
  );
});

test('stop waits for a cancelled claim before removing target messages', async (t) => {
  const { h, main, child } = await projectWithThread(t);
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

test('holding a project cancels in-flight starts and holds queued threads', async (t) => {
  const { h, id, main } = await idleProject(t);
  const gate = deferred();
  const admitted = waitForThreadStarts(h.port, 19);
  h.state.bindGate = gate.promise;
  // The lead occupies one slot; nineteen starts reserve the rest and the last queues.
  const requests = Array.from({ length: 19 }, () => h.projects.spawn(main, input));
  await admitted;
  // Hold after the queued request has durably answered; the other nineteen are still binding.
  requests.push(h.projects.spawn(main, input));
  await requests[19];
  assert.equal(h.projects.list()[0]?.launching, 19);
  await h.projects.setPaused(id, true);
  gate.resolve();
  const outcomes = await Promise.allSettled(requests);
  assert.equal(outcomes.filter((result) => result.status === 'rejected').length, 19);
  assert.equal(h.state.saved[0]?.threads.filter((thread) => thread.queuedSpawn).length, 1);
  assert.equal(h.launched.length, 1, 'no child goal reached the provider');
  assert.equal(h.projects.list()[0]?.launching, 0);
});

test("a lead's message reaches a working thread's turn, or starts an idle one", async (t) => {
  const { h, main, child } = await projectWithThread(t);
  assert.equal(await h.projects.send(main, child.appSessionId, 'Also cover the tests'), 'steered');
  assert.equal(
    await h.projects.send(main, child.appSessionId, 'Stop, wrong branch', 'interrupt'),
    'interrupt',
  );
  assert.deepEqual(
    h.steered.map(({ now }) => now),
    [false, true],
  );
  await h.finish(child.appSessionId);
  await drain();
  const reported = h.sent.length;
  assert.equal(await h.projects.send(main, child.appSessionId, 'One more thing'), 'started');
  await drain();
  assert.ok(h.sent.slice(reported).some(({ id }) => id === child.appSessionId));
});

test('persistence failure fails closed without delivering a queued wake', async (t) => {
  const { h, main, child } = await projectWithThread(t);
  h.state.failSave = true;
  await assert.rejects(h.projects.send(main, child.appSessionId, 'Work', 'queue'), /Disk full/);
  await drain();
  assert.equal(h.sent.length, 0);
  assert.equal(h.projects.list()[0]?.paused, true);
  assert.match(h.projects.list()[0]?.error ?? '', /Disk full/);
});

test('work keeps flowing, and only a runaway loop holds the project', async (t) => {
  const { h, main, child } = await projectWithThread(t);
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
  assert.match(
    h.projects.list()[0]?.error ?? '',
    /delivery loop exceeded 60 deliveries in 5 minutes/,
  );
});

test('a released runtime unparks a delivery that was waiting for a slot', async (t) => {
  const { h, child } = await projectWithThread(t);
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
  const { h, main } = await idleProject(t);
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

  // Stopping the lead leaves worker coordination running, but holds its reports.
  await h.projects.userStopped(main);
  assert.equal(h.projects.list()[0]?.paused, false);
  assert.equal(h.projects.list()[0]?.leadStopped, true);
});

test('a new spawn never resumes a stopped lead; only the user continues it', async (t) => {
  const { h, main } = await idleProject(t);
  const underway = h.projects.spawn(main, input);
  await h.projects.userStopped(main);
  await assert.rejects(underway, /cancelled/);
  const child = await h.projects.spawn(main, input);
  assert.equal(h.projects.list()[0]?.paused, false);
  assert.equal(h.state.saved[0]?.leadStopped, true);
  await h.finish(child.appSessionId, 'Work finished while the lead was stopped.');
  await drain();
  assert.equal(h.sent.length, 0);
  assert.equal(h.state.saved[0]?.pending.length, 1);
  await h.projects.userContinued(main);
  await drain();
  assert.equal(h.sent.length, 1);
  assert.match(h.sent[0].prompt, /Work finished while the lead was stopped/);
  assert.equal(h.state.saved[0]?.leadStopped, undefined);

  // A failure's hold stays the user's to lift, even after a later Stop.
  h.state.failSave = true;
  await assert.rejects(h.projects.send(main, child.appSessionId, 'Work', 'queue'), /Disk full/);
  h.state.failSave = false;
  await h.projects.userStopped(main);
  await assert.rejects(h.projects.spawn(main, input), /held/);
});

test('a closed recipient unparks the delivery that waited on its turn', async (t) => {
  const h = await harness(t);
  const { main } = await h.root();
  const child = await h.projects.spawn(main, input);
  await h.projects.send(main, child.appSessionId, 'Continue', 'queue');
  await drain();
  assert.equal(h.sent.length, 0);
  const recipient = h.sessions.get(child.appSessionId);
  assert.ok(recipient);
  recipient.streaming = false;
  await h.projects.observe({ type: 'session.closed', appSessionId: child.appSessionId });
  await drain();
  assert.equal(h.sent.at(-1)?.id, child.appSessionId);
  assert.equal(h.projects.list()[0]?.queued, 0);
});

test('a model named the way a chat names its own resolves to that one, not its hosted twin', async (t) => {
  const { h, main } = await idleProject(t);
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
  const { h, main, child } = await projectWithThread(t);
  await h.finish(child.appSessionId, 'Conclusion.' + 'x'.repeat(1_989));
  await drain();
  // The report is an excerpt; reading the thread gives the whole reply back.
  assert.match(h.sent.at(-1)?.prompt ?? '', /first 1,200 characters.*thread_read full: true/);
  assert.match(h.sent.at(-1)?.prompt ?? '', /Conclusion\./);
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
  const { h, main } = await idleProject(t);
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
  const { h, main } = await idleProject(t);
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

test(
  "retuning a thread's model never waits on a turn that may be waiting on its lead",
  { timeout: 10_000 },
  async (t) => {
    const { h, main, child } = await projectWithThread(t);
    // A Claude thread takes a new model or effort only once its running turn
    // ends, and that turn may be blocked on a question to this lead.
    h.port.configure = () => new Promise(() => undefined);
    const tuned = await h.projects.configure(main, child.appSessionId, { reasoningEffort: 'low' });
    assert.match(tuned.pending ?? '', /current turn ends/);
  },
);

test('a spawn carries a settled plan step, or none at all', async (t) => {
  const { h, main } = await idleProject(t);
  await assert.rejects(h.projects.spawn(main, { ...input, step: 'Ship the moon' }), /no plan yet/);
  await h.projects.setPlan(main, [{ title: 'Port the payments client', state: 'review' }]);
  await assert.rejects(h.projects.spawn(main, { ...input, step: 'Ship the moon' }), /No plan step/);
  const started = await h.projects.spawn(main, { ...input, step: 'Port the payments client' });
  assert.equal(h.projects.list()[0]?.plan[0]?.threadAppSessionId, started.appSessionId);
  assert.equal(h.projects.list()[0]?.plan[0]?.state, 'review');

  // A stable step id picks the intended step when two share a title.
  await h.projects.setPlan(main, [{ title: 'Review' }, { title: 'Review' }]);
  const stepId = h.projects.list()[0]?.plan[1]?.id;
  assert.ok(stepId);
  const second = await h.projects.spawn(main, { ...input, step: stepId });
  const plan = h.projects.list()[0]?.plan;
  assert.equal(plan?.[0]?.threadAppSessionId, undefined);
  assert.equal(plan?.[1]?.threadAppSessionId, second.appSessionId);
});

test('an ordinary chat that writes a plan becomes a project and spawns for its steps', async (t) => {
  const h = await ordinaryChat(t);
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
  const h = await ordinaryChat(t, { ...input, title: 'Payments' });
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
  const { h, main } = await idleProject(t);
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

test('durable project request identity avoids a duplicate root', async (t) => {
  const h = await harness(t);
  const first = await h.projects.create(input, 'request-1');
  const repeat = await h.projects.create(input, 'request-1');
  assert.equal(first.projectId, 'request-1');
  assert.equal(repeat.projectId, 'request-1');
  // The repeat must name the same conversation, or the caller opens nothing.
  assert.ok(first.appSessionId);
  assert.equal(repeat.appSessionId, first.appSessionId);
  assert.equal(h.launched.length, 1);
});

test('a thread’s own question reaches its lead with its options, and the answer goes back at once', async (t) => {
  const { h, main, child } = await projectWithThread(t);
  await h.ask(child.appSessionId, 'ask-1', 'Which storage format?', [
    { label: 'JSON' },
    { label: 'SQLite' },
  ]);
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
  assert.equal(
    (await h.projects.answer(main, child.appSessionId, 'ask-1', ['JSON'])).answered,
    true,
  );
  assert.equal(h.answered.at(-1)?.requestId, 'ask-1');
  assert.equal(h.projects.list()[0]?.threads[1]?.waiting, false);
  assert.equal(h.projects.list()[0]?.queued, 0);
});

test('a question answered in its thread stops asking the owner, and a late answer never lands on a newer one', async (t) => {
  const { h, main, child } = await projectWithThread(t);
  await h.ask(child.appSessionId, 'ask-1');
  // Mid-turn, but stopped on its question: the owner is told it is waiting.
  assert.equal(h.projects.read(main, child.appSessionId).questionId, 'ask-1');
  assert.equal(h.projects.read(main, child.appSessionId).state, 'waiting');
  // The person answers in the thread itself: no event says so, and the turn
  // carries on. The owner must stop being told to answer it.
  h.asking.delete(child.appSessionId);
  await h.streaming(child.appSessionId, true);
  assert.equal(h.projects.list()[0]?.threads[1]?.waiting, false);
  // The thread then asks something else.
  await h.ask(child.appSessionId, 'ask-2', 'Delete the old files?');

  // The lead decided the first question, so its answer must not settle the second.
  await assert.rejects(
    h.projects.answer(main, child.appSessionId, 'ask-1', ['JSON']),
    /no longer waiting on that question/,
  );
  await assert.rejects(h.projects.answer(main, child.appSessionId, '', ['yes']), /questionId/);
  assert.deepEqual(h.answered, []);
  assert.equal((await h.projects.answer(main, child.appSessionId, 'ask-2', ['no'])).answered, true);
});

test('threads stopped on questions for their lead leave it a delivery slot', async (t) => {
  const { h, main } = await idleProject(t);
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
  for (const [index, id] of threads.entries()) await h.ask(id, `ask-${String(index)}`);
  await drain();
  assert.equal(h.sent.at(-1)?.id, main, 'the lead is woken to answer them');
  assert.match(h.sent.at(-1)?.prompt ?? '', /Which format/);
});

test('an outsized harness question is bounded to what the ledger will load', async (t) => {
  const { h, child } = await projectWithThread(t);
  await h.projects.observe({
    type: 'question.requested',
    question: {
      appSessionId: child.appSessionId,
      requestId: 'huge',
      questions: Array.from({ length: 40 }, (_, index) => ({
        index: index + 1_000,
        question: 'q'.repeat(9_000),
        options: Array.from({ length: 40 }, () => ({ label: 'o'.repeat(4_000) })),
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
  const { h, child } = await projectWithThread(t);
  await h.ask(child.appSessionId, 'ask-dead', 'Which format?', [{ label: 'JSON' }], false);
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

test('a delivery withdrawn before dispatch holds nothing and keeps what is still wanted', async (t) => {
  const { h, id, main } = await idleProject(t);
  const reporter = await h.projects.spawn(main, input);
  const asker = await h.projects.spawn(main, input);
  const gate = deferred();
  h.state.gate = gate.promise;
  // A report and a question are claimed together for the lead.
  await h.finish(reporter.appSessionId, 'Parsed the config.');
  await h.ask(asker.appSessionId, 'ask');
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
  const { h, child } = await projectWithThread(t);
  const gate = deferred();
  h.state.gate = gate.promise;
  await h.ask(child.appSessionId, 'ask-1');
  await tick();
  // Answered in the thread while its wake waits, then a different question.
  h.asking.delete(child.appSessionId);
  await h.streaming(child.appSessionId, true);
  await h.ask(child.appSessionId, 'ask-2', 'Delete the old files?');
  gate.resolve();
  await drain();
  assert.equal(h.sent.length, 1);
  assert.doesNotMatch(h.sent[0]?.prompt ?? '', /Which format/);
  assert.match(h.sent[0]?.prompt ?? '', /question ask-2\):\nDelete the old files/);
});

test("permission requests and the main chat's own question stay with the user", async (t) => {
  const { h, main } = await idleProject(t);
  await h.projects.observe({
    type: 'approval.requested',
    request: {
      appSessionId: main,
      requestId: 'approval',
      kind: 'exec',
      title: 'Run?',
      detail: 'A command',
      canAlwaysAllow: false,
      raw: {},
    },
  });
  await h.ask(main, 'question', 'User decision?', [], false);
  await drain();
  assert.equal(h.sent.length, 0);
});

test('a queued startup failure wakes the lead and waits for thread_send to retry', async (t) => {
  const { h, main } = await projectWithThread(t);
  h.state.capacity = 'busy';
  const queued = await h.projects.spawn(main, { ...input, title: 'Queued' });
  h.state.createFailure = 'before-bind';
  h.state.capacity = 'free';
  h.projects.capacityChanged();
  await drain();
  assert.equal(h.projects.read(main, queued.appSessionId).state, 'failed');
  assert.equal(h.projects.list()[0].paused, false);
  assert.match(
    h.sent[0].prompt,
    /Queued failed: The harness refused to start.*Continue it with thread_send/,
  );
  assert.equal(
    h.state.saved[0].threads.find((thread) => thread.appSessionId === queued.appSessionId)
      ?.queuedSpawn?.phase,
    'failed',
  );
  h.state.createFailure = undefined;
  await h.projects.send(main, queued.appSessionId, 'Retry opening the session.');
  await drain();
  assert.equal(h.projects.read(main, queued.appSessionId).state, 'working');
});
