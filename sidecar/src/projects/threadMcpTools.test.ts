import assert from 'node:assert/strict';
import test from 'node:test';
import { drain, harness, input } from '../testing/projectServiceHarness.js';
import { registerProjectService } from './service.js';
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

test('thread_list returns controlled threads, runtime load and lead to-dos without starting work', async (t) => {
  const h = await harness(t, [recovered]);
  registerProjectService(Promise.resolve(h.projects));
  const list = await call('lead0000-main', 'thread_list');
  assert.ok(Array.isArray(list.threads));
  assert.deepEqual(list, {
    ok: true,
    threads: recovered.threads.slice(1).map((thread) => ({
      threadId: thread.appSessionId,
      title: thread.title,
      ownerId: thread.ownerAppSessionId,
      state: 'idle',
      waitReason: 'no turn running',
      lastReply: thread.reply,
      queued: 0,
    })),
    runtimeLoad: { live: 0, limit: 12 },
    todos: [],
  });
  assert.deepEqual((await call('worker00-alpha', 'thread_list')).threads, [list.threads[2]]);
  assert.equal(h.sent.length, 0);
  assert.equal(h.launched.length, 0);
});

test('thread ids accept unique scoped prefixes and reject ambiguity or foreign ownership', async (t) => {
  const h = await harness(t, [recovered]);
  registerProjectService(Promise.resolve(h.projects));
  const read = await call('lead0000-main', 'thread_read', { threadId: 'worker00-a' });
  assert.equal(read.threadId, 'worker00-alpha');
  assert.deepEqual(read.replies, ['First reply']);
  const ambiguous = await call('lead0000-main', 'thread_read', { threadId: 'worker00' });
  assert.equal(ambiguous.ok, false);
  assert.match(String(ambiguous.error), /Alpha \(worker00-alpha\).*Bravo \(worker00-bravo\)/);
  assert.equal((await call('lead0000-main', 'thread_read', { threadId: 'worker' })).ok, false);
  assert.equal(
    (await call('worker00-alpha', 'thread_read', { threadId: 'worker00-bravo' })).ok,
    false,
  );
  assert.equal(
    (await call('worker00-alpha', 'thread_read', { threadId: 'worker00' })).threadId,
    'worker00-child',
  );
});

test('todo_add keeps a lead follow-up and todo_done removes it durably', async (t) => {
  t.mock.timers.enable({ apis: ['Date', 'setTimeout'], now: 1_000_000 });
  const h = await harness(t, [recovered]);
  registerProjectService(Promise.resolve(h.projects));
  const todo = await call('lead0000-main', 'todo_add', {
    text: 'Review the parser',
    after: 'worker00-a',
    inMinutes: 1,
  });
  assert.equal(typeof todo.id, 'string');
  assert.deepEqual(todo, {
    ok: true,
    id: todo.id,
    text: 'Review the parser',
    after: 'worker00-alpha',
    dueAt: 1_060_000,
  });
  assert.deepEqual(h.state.saved[0]?.todos, [
    {
      id: todo.id,
      text: 'Review the parser',
      after: 'worker00-alpha',
      dueAt: 1_060_000,
    },
  ]);
  assert.equal((await call('worker00-alpha', 'todo_add', { text: 'Cannot own this' })).ok, false);
  assert.deepEqual(await call('lead0000-main', 'todo_done', { id: todo.id }), {
    ok: true,
    id: todo.id,
  });
  assert.deepEqual(h.state.saved[0]?.todos, []);
});

test('thread_spawn reports a real queued start with its position and a matching-thread hint', async (t) => {
  const h = await harness(t);
  const { main } = await h.root();
  registerProjectService(Promise.resolve(h.projects));
  const first = await call(main, 'thread_spawn', { ...input, reportBack: true, title: 'Parser' });
  assert.equal(first.delivery, 'started');
  assert.equal(first.state, 'working');
  await h.finish(String(first.threadId), 'Ready');
  await drain();
  h.state.capacity = 'busy';
  const retry = await call(main, 'thread_spawn', {
    ...input,
    reportBack: true,
    title: 'parser (retry)',
  });
  assert.equal(retry.delivery, 'queued');
  assert.equal(retry.state, 'queued');
  assert.equal(retry.position, 1);
  assert.equal(retry.waitReason, 'queued to start · 1st');
  assert.deepEqual(retry.runtimeLoad, { live: 12, limit: 12 });
  assert.match(String(retry.note), /Queued to start/);
  assert.ok(String(retry.reuseNote).includes(`Parser (${String(first.threadId)})`));
  const list = await call(main, 'thread_list');
  assert.ok(Array.isArray(list.threads));
  assert.deepEqual(
    list.threads
      .filter((thread) => thread.threadId === retry.threadId)
      .map((thread) => [thread.state, thread.position]),
    [['queued', 1]],
  );
  await drain();
  assert.equal(h.sessions.has(String(retry.threadId)), false);
  h.state.capacity = 'free';
  h.projects.capacityChanged();
  await drain();
  assert.equal((await call(main, 'thread_read', { threadId: retry.threadId })).state, 'working');
  const sent = await call(main, 'thread_send', {
    threadId: retry.threadId,
    text: 'Then cover the tests',
    delivery: 'queue',
  });
  assert.equal(sent.delivery, 'queued');
  assert.equal(sent.waitReason, 'message waits for its turn to end');
  await drain();
  assert.deepEqual((await call(main, 'thread_read', { threadId: retry.threadId })).wait, {
    kind: 'turn',
  });
  h.sessions.delete(String(retry.threadId));
  h.state.capacity = 'busy';
  await h.projects.observe({ type: 'session.closed', appSessionId: String(retry.threadId) });
  await drain();
  const waiting = await call(main, 'thread_read', { threadId: retry.threadId });
  assert.deepEqual(waiting.wait, { kind: 'slot', position: 1 });
  assert.equal(waiting.position, 1);
  assert.equal(waiting.waitReason, 'waiting for a free slot · 1st in line (12 running, limit 12)');
  assert.deepEqual(waiting.runtimeLoad, { live: 12, limit: 12 });
});
