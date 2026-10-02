import assert from 'node:assert/strict';
import test from 'node:test';
import { LEDGER_LIMITS } from './store.js';
import { deferred, drain, harness, input, tick } from '../testing/projectServiceHarness.js';

test('a thread’s own question reaches its lead with its options, and the answer goes back at once', async (t) => {
  const h = await harness(t);
  const { main } = await h.root();
  const child = await h.projects.spawn(main, input);
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
  assert.equal(await h.projects.send(main, child.appSessionId, '', ['JSON'], 'ask-1'), 'answered');
  assert.equal(h.answered.at(-1)?.requestId, 'ask-1');
  assert.equal(h.projects.list()[0]?.threads[1]?.waiting, false);
  assert.equal(h.projects.list()[0]?.queued, 0);
});

test('a question answered in its thread stops asking the owner, and a late answer never lands on a newer one', async (t) => {
  const h = await harness(t);
  const { main } = await h.root();
  const child = await h.projects.spawn(main, input);
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
    h.projects.send(main, child.appSessionId, '', ['JSON'], 'ask-1'),
    /no longer waiting on that question/,
  );
  await assert.rejects(h.projects.send(main, child.appSessionId, '', ['yes']), /questionId/);
  assert.deepEqual(h.answered, []);
  assert.equal(await h.projects.send(main, child.appSessionId, '', ['no'], 'ask-2'), 'answered');
});

test('threads stopped on questions for their lead leave it a delivery slot', async (t) => {
  const h = await harness(t);
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
  for (const [index, id] of threads.entries()) await h.ask(id, `ask-${String(index)}`);
  await drain();
  assert.equal(h.sent.at(-1)?.id, main, 'the lead is woken to answer them');
  assert.match(h.sent.at(-1)?.prompt ?? '', /Which format/);
});

test('an outsized harness question is bounded to what the ledger will load', async (t) => {
  const h = await harness(t);
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
  const h = await harness(t);
  const { main } = await h.root();
  const child = await h.projects.spawn(main, input);
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
  const h = await harness(t);
  const { id, main } = await h.root();
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
  const h = await harness(t);
  const { main } = await h.root();
  const child = await h.projects.spawn(main, input);
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
  const h = await harness(t);
  const { main } = await h.root();
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
