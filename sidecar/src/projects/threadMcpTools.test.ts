import assert from 'node:assert/strict';
import test from 'node:test';
import {
  deferred,
  drain,
  git,
  gitRepository,
  harness,
  input,
  summary,
} from '../testing/projectServiceHarness.js';
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

test('thread_list stays compact for 86 threads and all returns the controlled inventory', async (t) => {
  const saved = structuredClone(recovered);
  for (let index = saved.threads.length; index < 86; index += 1)
    saved.threads.push({
      appSessionId: `idle-${index}`,
      ownerAppSessionId: 'lead0000-main',
      title: `Idle ${index}`,
      reply: '',
      waiting: false,
    });
  const h = await harness(t, [saved], false);
  registerProjectService(Promise.resolve(h.projects));
  const compact = await call('lead0000-main', 'thread_list');
  assert.deepEqual(compact, {
    ok: true,
    threads: [],
    summary: '85 inactive threads; pass all: true to list them',
    runtimeLoad: { live: 0, limit: 20 },
    todos: [],
  });
  const list = await call('lead0000-main', 'thread_list', { all: true });
  assert.ok(Array.isArray(list.threads));
  assert.equal(list.threads.length, 85);
  assert.equal(list.summary, undefined);
  assert.deepEqual(
    list.threads.slice(0, 3),
    recovered.threads.slice(1).map((thread) => ({
      threadId: thread.appSessionId,
      title: thread.title,
      ownerId: thread.ownerAppSessionId,
      state: 'idle',
      waitReason: 'no turn running',
      lastReply: thread.reply,
      queued: 0,
    })),
  );
  assert.deepEqual((await call('worker00-alpha', 'thread_list', { all: true })).threads, [
    list.threads[2],
  ]);
  h.sessions.set('worker00-alpha', summary('worker00-alpha'));
  await h.streaming('worker00-alpha', true);
  await h.finish('worker00-alpha', `Done.\n\n${'Details '.repeat(30)}`);
  h.sessions.set('worker00-bravo', { ...summary('worker00-bravo'), streaming: true });
  h.sessions.set('worker00-child', { ...summary('worker00-child'), phase: 'failed' });
  const active = await call('lead0000-main', 'thread_list');
  assert.ok(Array.isArray(active.threads));
  assert.deepEqual(
    active.threads.map((thread) => [thread.threadId, thread.state]),
    [
      ['worker00-alpha', 'idle'],
      ['worker00-bravo', 'working'],
      ['worker00-child', 'failed'],
    ],
  );
  assert.equal(active.threads[0].lastReply.length, 120);
  assert.doesNotMatch(active.threads[0].lastReply, /\n/);
  assert.equal(active.summary, '82 inactive threads; pass all: true to list them');
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

test('thread_read clears unread durably without starting a runtime', async (t) => {
  const saved = structuredClone(recovered);
  saved.threads[1].unread = true;
  const h = await harness(t, [saved]);
  registerProjectService(Promise.resolve(h.projects));
  const before = await call('lead0000-main', 'thread_list');
  assert.ok(Array.isArray(before.threads));
  assert.equal(before.threads[0]?.unread, true);
  const read = await call('lead0000-main', 'thread_read', { threadId: 'worker00-a' });
  assert.deepEqual(read.replies, ['First reply']);
  assert.equal(h.state.saved[0]?.threads[1]?.unread, undefined);
  assert.deepEqual((await call('lead0000-main', 'thread_list')).threads, []);
  assert.equal(h.sent.length, 0);
  assert.equal(h.launched.length, 0);
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
  assert.deepEqual(retry.runtimeLoad, { live: 20, limit: 20 });
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
  assert.equal(waiting.waitReason, 'waiting for a free slot · 1st in line (20 running, limit 20)');
  assert.deepEqual(waiting.runtimeLoad, { live: 20, limit: 20 });
});

test('cancelling a queued spawn removes its thread, plan link and reserved checkout', async (t) => {
  const repository = await gitRepository(t);
  const h = await harness(t);
  h.sessions.set('ordinary', summary('ordinary', { ...input, cwd: repository }));
  await h.projects.setPlan('ordinary', [{ title: 'Parser' }]);
  h.state.capacity = 'busy';
  const queued = await h.projects.spawn('ordinary', {
    ...input,
    title: 'Parser',
    step: '1',
    workspace: 'worktree',
  });
  assert.equal(queued.delivery, 'queued');
  assert.ok(queued.branch);
  registerProjectService(Promise.resolve(h.projects));
  assert.deepEqual(await call('ordinary', 'thread_stop', { threadId: queued.appSessionId }), {
    ok: true,
    threadId: queued.appSessionId,
    state: 'cancelled',
  });
  assert.equal(
    h.state.saved[0]?.threads.some((thread) => thread.appSessionId === queued.appSessionId),
    false,
  );
  assert.equal(
    h.projects.list()[0]?.threads.some((thread) => thread.appSessionId === queued.appSessionId),
    false,
  );
  assert.equal(h.state.saved[0]?.plan[0]?.threadAppSessionId, undefined);
  const sent = await call('ordinary', 'thread_send', {
    threadId: queued.appSessionId,
    text: 'Continue',
  });
  assert.equal(sent.ok, false);
  assert.match(String(sent.error), /outside/);
  assert.equal((await git(repository, ['branch', '--list', queued.branch])).stdout.trim(), '');
  assert.equal(
    (await git(repository, ['worktree', 'list', '--porcelain'])).stdout.match(/^worktree /gm)
      ?.length,
    1,
  );
  assert.equal(h.projects.list()[0]?.paused, false);
});

test('thread_configure persists queued settings and uses them when capacity opens', async (t) => {
  const h = await harness(t);
  const { main } = await h.root();
  h.state.capacity = 'busy';
  const queued = await h.projects.spawn(main, input);
  registerProjectService(Promise.resolve(h.projects));
  const tuned = await call(main, 'thread_configure', {
    threadId: queued.appSessionId,
    modelId: 'droid-core',
    reasoningEffort: 'high',
    autonomy: 'off',
  });
  assert.equal(tuned.ok, true);
  assert.equal(tuned.state, 'queued');
  assert.equal(tuned.modelId, 'droid-core');
  assert.equal(tuned.reasoningEffort, 'high');
  assert.equal(tuned.autonomy, 'off');
  assert.equal(tuned.pending, undefined);
  assert.equal(h.state.saved[0]?.threads[1]?.queuedSpawn?.input.autonomy, 'off');
  const elevated = await call(main, 'thread_configure', {
    threadId: queued.appSessionId,
    autonomy: 'high',
  });
  assert.equal(elevated.ok, false);
  assert.match(String(elevated.error), /cannot exceed/);
  h.state.capacity = 'free';
  h.projects.capacityChanged();
  await drain();
  assert.equal(h.launched.at(-1)?.modelId, 'droid-core');
  assert.equal(h.launched.at(-1)?.reasoningEffort, 'high');
  assert.equal(h.launched.at(-1)?.autonomy, 'off');
});

test('thread_configure refuses changes during opening and accepts them after binding', async (t) => {
  const h = await harness(t, [], false);
  const { main } = await h.root();
  h.state.capacity = 'busy';
  const queued = await h.projects.spawn(main, input);
  registerProjectService(Promise.resolve(h.projects));
  const binding = deferred();
  h.state.bindGate = binding.promise;
  h.state.capacity = 'free';
  h.projects.historyReady();
  await drain();
  const refused = await call(main, 'thread_configure', {
    threadId: queued.appSessionId,
    autonomy: 'off',
  });
  binding.resolve();
  await drain();
  assert.equal(refused.ok, false);
  assert.match(String(refused.error), /opening.*once it has started/);
  assert.equal(h.launched.at(-1)?.autonomy, 'low');
  assert.equal(h.projects.read(main, queued.appSessionId).autonomy, 'low');
  assert.equal(
    (
      await call(main, 'thread_configure', {
        threadId: queued.appSessionId,
        autonomy: 'off',
      })
    ).autonomy,
    'off',
  );
});
