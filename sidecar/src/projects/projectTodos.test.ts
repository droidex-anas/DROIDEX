import assert from 'node:assert/strict';
import test from 'node:test';
import { deferred, drain, harness, input } from '../testing/projectServiceHarness.js';

test('a reminder finished while its scheduled delivery was in flight does not come back', async (t) => {
  const h = await harness(t);
  const { main } = await h.root();
  const worker = await h.projects.spawn(main, input);
  const gate = deferred();
  h.state.gate = gate.promise;
  await h.finish(worker.appSessionId, 'Implemented the parser.');
  const todo = await h.projects.addTodo(main, { text: 'Review it', after: worker.appSessionId });
  await drain();
  await h.projects.doneTodo(main, todo.id);
  await h.streaming(main, true);
  h.state.gate = undefined;
  gate.resolve();
  await drain();
  await h.finish(main);
  await drain();
  const toLead = [...h.sent, ...h.steered]
    .filter(({ id }) => id === main)
    .map(({ prompt }) => prompt);
  assert.ok(toLead.some((prompt) => prompt.includes('Implemented the parser.')));
  assert.ok(toLead.every((prompt) => !prompt.includes('Reminder')));
});

test('finishing the only claimed reminder settles its delivery and plan ids like 1.1 save', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'] });
  const h = await harness(t);
  const { id, main } = await h.root();
  const gate = deferred();
  h.state.gate = gate.promise;
  const todo = await h.projects.addTodo(main, { text: 'Check in', inMinutes: 1 });
  t.mock.timers.tick(60_000);
  await drain();
  const claimed = h.state.saved.find((candidate) => candidate.id === id)?.delivery;
  assert.deepEqual(
    claimed?.messages.map((message) => message.id),
    [todo.id],
  );
  await h.projects.doneTodo(main, todo.id);
  // An emptied claim would fail the store's validation and pause every project.
  assert.equal(h.state.saved.find((candidate) => candidate.id === id)?.delivery, undefined);
  await h.projects.setPlan(main, [{ id: '1.1', title: 'First part' }]);
  h.state.gate = undefined;
  gate.resolve();
  await drain();
  const saved = h.state.saved.find((candidate) => candidate.id === id);
  assert.equal(saved?.paused, false);
  assert.equal(saved?.delivery, undefined);
  assert.equal(saved?.plan[0]?.id, '1.1');
});

test('odd plan ids do not stall numbering, and a reminder finished during preparation is not sent', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'] });
  const h = await harness(t);
  const { main } = await h.root();
  const odd = [
    { id: 'Infinity', title: 'Odd id' },
    { id: '9007199254740991', title: 'Huge id' },
  ];
  await h.projects.setPlan(main, odd);
  await h.projects.setPlan(main, [...odd, { title: 'Next' }, { title: 'After' }]);
  const worker = await h.projects.spawn(main, input);
  const gate = deferred();
  h.state.gate = gate.promise;
  await h.finish(worker.appSessionId, 'Implemented the parser.');
  const todo = await h.projects.addTodo(main, { text: 'Check in', inMinutes: 1 });
  t.mock.timers.tick(60_000);
  await drain();
  await h.projects.doneTodo(main, todo.id);
  h.state.gate = undefined;
  gate.resolve();
  await drain();
  const toLead = [...h.sent, ...h.steered]
    .filter(({ id }) => id === main)
    .map(({ prompt }) => prompt);
  assert.ok(toLead.some((prompt) => prompt.includes('Implemented the parser.')));
  assert.ok(toLead.every((prompt) => !prompt.includes('Reminder')));
});
