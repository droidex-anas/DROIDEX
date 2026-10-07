import assert from 'node:assert/strict';
import test from 'node:test';
import { drain, harness, input, summary } from '../testing/projectServiceHarness.js';
import { ProjectWakeQueue } from './ProjectWakeQueue.js';
import { registerProjectService } from './service.js';
import { LEDGER_LIMITS } from './store.js';
import { threadTools } from './threadMcpTools.js';
import type { Project } from './types.js';

async function call(source: string, name: string, input: Record<string, unknown> = {}) {
  const tool = threadTools(() => source).find((tool) => tool.name === name);
  assert.ok(tool);
  const result = await tool.handler(input);
  const text =
    typeof result === 'string' ? result : result.content.find((item) => item.type === 'text')?.text;
  assert.equal(typeof text, 'string');
  const value: Record<string, unknown> = JSON.parse(text ?? '');
  return value;
}

const recovered: Project = {
  id: 'project',
  title: 'Build',
  paused: false,
  launching: 0,
  plan: [],
  todos: [],
  pending: [],
  threads: [
    { appSessionId: 'lead0000-main', title: 'Lead', reply: '', waiting: false },
    {
      appSessionId: 'worker00-alpha',
      ownerAppSessionId: 'lead0000-main',
      title: 'Alpha',
      reply: 'First reply',
      waiting: false,
    },
    {
      appSessionId: 'worker00-bravo',
      ownerAppSessionId: 'lead0000-main',
      title: 'Bravo',
      reply: '',
      waiting: false,
    },
    {
      appSessionId: 'worker00-child',
      ownerAppSessionId: 'worker00-alpha',
      title: 'Child',
      reply: '',
      waiting: false,
    },
  ],
};

test('thread tools recover scoped ids and resolve prefixes before reading, planning or sending', async (t) => {
  const h = await harness(t, [recovered]);
  registerProjectService(Promise.resolve(h.projects));
  for (const thread of recovered.threads)
    h.sessions.set(thread.appSessionId, summary(thread.appSessionId));
  const source = 'lead0000-main';
  const list = await call(source, 'thread_list');
  assert.ok(Array.isArray(list.threads));
  assert.deepEqual(
    list.threads.map((thread) => thread.threadId),
    ['worker00-alpha', 'worker00-bravo', 'worker00-child'],
  );
  assert.deepEqual((await call('worker00-alpha', 'thread_list')).threads, [list.threads[2]]);
  const read = await call(source, 'thread_read', { threadId: 'worker00-a' });
  assert.equal(read.threadId, 'worker00-alpha');
  assert.deepEqual(read.replies, ['First reply']);
  assert.equal(h.sent.length, 0);
  assert.equal(h.launched.length, 0);
  const ambiguous = await call(source, 'thread_read', { threadId: 'worker00' });
  assert.match(String(ambiguous.error), /Alpha \(worker00-alpha\).*Bravo \(worker00-bravo\)/);
  assert.equal((await call(source, 'thread_read', { threadId: 'worker' })).ok, false);
  assert.equal(
    (await call('worker00-alpha', 'thread_read', { threadId: 'worker00-bravo' })).ok,
    false,
  );
  assert.equal(
    (await call('worker00-alpha', 'thread_read', { threadId: 'worker00' })).threadId,
    'worker00-child',
  );
  assert.equal(
    (await call(source, 'plan_set', { steps: [{ title: 'Build', threadId: 'worker00-a' }] })).ok,
    true,
  );
  assert.equal(h.projects.list()[0]?.plan[0]?.threadAppSessionId, 'worker00-alpha');
  const review = await call(source, 'thread_spawn', {
    ...input,
    reportBack: true,
    workspaceOf: 'worker00-a',
    title: 'Review',
  });
  assert.equal(review.ok, true);
  assert.equal(review.cwd, '/workspace');
  assert.equal(
    (await call(source, 'thread_configure', { threadId: 'worker00-a', reasoningEffort: 'low' }))
      .threadId,
    'worker00-alpha',
  );
  const sent = await call(source, 'thread_send', { threadId: 'worker00-a', text: 'Continue' });
  assert.equal(sent.threadId, 'worker00-alpha');
  assert.equal(sent.delivery, 'queued');
  assert.equal(sent.position, 1);
  await drain();
  assert.equal(h.sent[0]?.id, 'worker00-alpha');
  assert.equal(
    (await call(source, 'thread_stop', { threadId: 'worker00-a' })).threadId,
    'worker00-alpha',
  );
});

test('spawn results name queued work honestly and suggest continuing a matching idle thread', async (t) => {
  const h = await harness(t);
  const { main } = await h.root();
  registerProjectService(Promise.resolve(h.projects));
  const first = await call(main, 'thread_spawn', { ...input, reportBack: true, title: 'Parser' });
  assert.equal(first.delivery, 'started');
  assert.equal(first.state, 'working');
  const id = String(first.threadId);
  await h.finish(id, 'Ready');
  t.mock.method(ProjectWakeQueue.prototype, 'waitReason', (target: string) =>
    target === id ? undefined : { kind: 'start', position: 3 },
  );
  const retry = await call(main, 'thread_spawn', {
    ...input,
    reportBack: true,
    title: 'parser (retry)',
  });
  assert.equal(retry.state, 'queued');
  assert.equal(retry.delivery, 'queued');
  assert.equal(retry.position, 3);
  assert.ok(String(retry.reuseNote).includes(`Parser (${id})`));
  assert.match(String(retry.reuseNote), /idle; thread_send continues it/);
  const listed = await call(main, 'thread_list');
  assert.ok(Array.isArray(listed.threads));
  assert.equal(listed.threads.at(-1)?.state, 'queued');
  assert.equal(listed.threads.at(-1)?.waitReason, 'queued to start · 3rd');
  t.mock.method(ProjectWakeQueue.prototype, 'waitReason', () => ({ kind: 'slot', position: 2 }));
  h.port.runtimeLoad = () => ({ live: 14, limit: 12 });
  const waiting = await call(main, 'thread_read', { threadId: id });
  assert.equal(waiting.waitReason, 'waiting for a free slot · 2nd in line (14 running, limit 12)');
  assert.deepEqual(waiting.runtimeLoad, { live: 14, limit: 12 });
});

test('lead follow-ups persist, become due with their report, sort first and are removed by todo_done', async (t) => {
  const h = await harness(t);
  const { main } = await h.root();
  registerProjectService(Promise.resolve(h.projects));
  const child = await h.projects.spawn(main, input);
  const later = await call(main, 'todo_add', { text: 'Tell the user' });
  const after = await call(main, 'todo_add', {
    text: 'Review the parser',
    after: child.appSessionId,
  });
  assert.equal(h.state.saved[0]?.todos[1]?.after, child.appSessionId);
  assert.equal((await call(child.appSessionId, 'todo_add', { text: 'Cannot own this' })).ok, false);
  await h.finish(child.appSessionId, 'Parser implemented');
  await drain();
  const wake = h.sent.at(-1)?.prompt ?? '';
  assert.match(wake, /Parser implemented/);
  const todos = wake.slice(wake.indexOf('Open to-dos:'));
  assert.ok(todos.indexOf('[DUE]') < todos.indexOf('Tell the user'));
  assert.match(wake, /Review the parser/);
  const list = await call(main, 'thread_list');
  assert.ok(Array.isArray(list.todos));
  assert.equal(list.todos[0]?.id, after.id);
  assert.equal(list.todos[0]?.due, true);
  assert.equal((await call(main, 'todo_done', { id: after.id })).ok, true);
  assert.deepEqual(
    h.projects.list()[0]?.todos.map((todo) => todo.id),
    [later.id],
  );
  assert.equal(h.state.saved[0]?.todos.length, 1);
  await h.finish(main);
  await h.streaming(main, true);
  await h.streaming(child.appSessionId, true);
  await h.finish(child.appSessionId, 'A report already queued');
  const late = await call(main, 'todo_add', {
    text: 'Review this queued report',
    after: child.appSessionId,
  });
  await h.finish(main);
  await drain();
  assert.match(h.sent.at(-1)?.prompt ?? '', /\[DUE\].*Review this queued report/);
  assert.ok(h.projects.list()[0]?.todos.some((todo) => todo.id === late.id && todo.due));
});

test('timed follow-ups rearm after restart, queue while busy and do not wake again once notified', async (t) => {
  t.mock.timers.enable({ apis: ['Date', 'setTimeout'], now: 1_000_000 });
  const h = await harness(t);
  const { main } = await h.root();
  registerProjectService(Promise.resolve(h.projects));
  const todo = await call(main, 'todo_add', { text: 'Check the build', inMinutes: 1 });
  assert.equal(todo.dueAt, 1_060_000);
  h.projects.close();
  const restored = await harness(t, h.state.saved, false);
  restored.sessions.set(main, summary(main));
  await restored.streaming(main, true);
  registerProjectService(Promise.resolve(restored.projects));
  t.mock.timers.tick(60_000);
  await drain();
  assert.equal(restored.sent.length, 0, 'history must be ready before delivering');
  restored.projects.historyReady();
  t.mock.timers.tick(0);
  await drain();
  assert.equal(restored.sent.length, 0, 'the busy lead uses the report delivery path');
  assert.equal(restored.projects.list()[0]?.todos[0]?.due, true);
  assert.equal(restored.projects.list()[0]?.queued, 1);
  await restored.finish(main);
  await drain();
  assert.equal(restored.sent.length, 1);
  assert.match(restored.sent[0]?.prompt ?? '', /Follow-up due.*Check the build/);
  await restored.finish(main);
  t.mock.timers.tick(60_000);
  await drain();
  assert.equal(restored.sent.length, 1);
  await call(main, 'todo_done', { id: todo.id });
  assert.deepEqual(restored.projects.list()[0]?.todos, []);
});

test('a due follow-up survives a full held inbox and todo_done cancels an unstarted timer', async (t) => {
  t.mock.timers.enable({ apis: ['Date', 'setTimeout'], now: 1_000_000 });
  const full = structuredClone(recovered);
  full.paused = true;
  full.pending = Array.from({ length: LEDGER_LIMITS.inbox }, (_, index) => ({
    id: `message-${String(index)}`,
    from: 'worker00-alpha',
    to: 'lead0000-main',
    kind: 'result',
    text: 'Report',
  }));
  const h = await harness(t, [full]);
  registerProjectService(Promise.resolve(h.projects));
  const main = 'lead0000-main';
  h.sessions.set(main, summary(main));
  const due = await call(main, 'todo_add', { text: 'Retained reminder', inMinutes: 1 });
  const removed = await call(main, 'todo_add', { text: 'Cancelled reminder', inMinutes: 1 });
  await call(main, 'todo_done', { id: removed.id });
  t.mock.timers.tick(60_000);
  await drain();
  assert.equal(h.projects.list()[0]?.queued, LEDGER_LIMITS.inbox);
  assert.equal(h.state.saved[0]?.todos[0]?.due, true);
  assert.equal(h.state.saved[0]?.todos[0]?.notified, undefined);
  await h.projects.setPaused('project', false);
  await drain();
  await h.finish(main);
  await drain();
  assert.ok(h.state.saved[0]?.pending.some((message) => message.id === due.id));
  assert.equal(h.state.saved[0]?.todos[0]?.notified, true);
  assert.ok(h.sent.every(({ prompt }) => !prompt.includes('Cancelled reminder')));
  await call(main, 'todo_done', { id: due.id });
  assert.ok(h.state.saved[0]?.pending.every((message) => message.id !== due.id));
});

test('to-do limits refuse bad input and the 41st open follow-up without losing the ledger', async (t) => {
  const h = await harness(t);
  const { main } = await h.root();
  registerProjectService(Promise.resolve(h.projects));
  for (const input of [
    { text: '' },
    { text: 'x'.repeat(401) },
    { text: 'Bad time', inMinutes: 0 },
    { text: 'Bad time', inMinutes: 1441 },
  ])
    await assert.rejects(call(main, 'todo_add', input));
  for (let index = 0; index < LEDGER_LIMITS.todos; index += 1)
    assert.equal((await call(main, 'todo_add', { text: `Follow-up ${String(index)}` })).ok, true);
  const refused = await call(main, 'todo_add', { text: 'One too many' });
  assert.match(String(refused.error), /40 open to-dos/);
  assert.equal(h.state.saved[0]?.todos.length, 40);
});
