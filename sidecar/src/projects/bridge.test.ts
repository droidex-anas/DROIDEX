import assert from 'node:assert/strict';
import test from 'node:test';
import type { ServerEvent } from '../protocol.js';
import { createProjectCommandHandler } from './bridge.js';
import {
  drain,
  harness,
  input,
  interruptedSummary,
  summary,
} from '../testing/projectServiceHarness.js';
import { LEDGER_LIMITS } from './store.js';
import type { Project } from './types.js';

test('failed project commands emit bounded errors and only valid request identities', async () => {
  for (const message of ['', 'x'.repeat(8_193)]) {
    const events: ServerEvent[] = [];
    const handle = createProjectCommandHandler(Promise.reject(new Error(message)), (event) =>
      events.push(event),
    );
    assert.equal(
      await handle({
        type: 'project.pause',
        requestId: 'request',
        projectId: 'project',
        paused: true,
      }),
      true,
    );
    assert.deepEqual(events, [
      {
        type: 'project.result',
        requestId: 'request',
        ok: false,
        error: message ? 'x'.repeat(8_192) : 'Projects command failed.',
      },
    ]);
  }

  const events: ServerEvent[] = [];
  const handle = createProjectCommandHandler(new Promise(() => {}), (event) => events.push(event));
  for (const requestId of [undefined, '', 'x'.repeat(201)]) {
    assert.equal(await handle({ type: 'project.pause', requestId }), true);
    assert.deepEqual(events.pop(), {
      type: 'error',
      code: 'project.invalid_command',
      message: 'Invalid Projects command.',
    });
  }
  const requestId = 'x'.repeat(200);
  assert.equal(await handle({ type: 'project.pause', requestId }), true);
  assert.deepEqual(events.pop(), {
    type: 'project.result',
    requestId,
    ok: false,
    error: 'Invalid Projects command.',
  });
});

test('Resume succeeds after Stop fills the inbox and leaves unread threads discoverable', async (t) => {
  const saved: Project = {
    id: 'project',
    title: 'Example',
    paused: false,
    launching: 0,
    plan: [],
    todos: [],
    pending: [],
    threads: [
      { appSessionId: 'main', title: 'Main', reply: '', waiting: false },
      {
        appSessionId: 'worker',
        ownerAppSessionId: 'main',
        title: 'Worker',
        reply: 'Done',
        unread: true,
        waiting: false,
      },
    ],
  };
  const h = await harness(t, [saved], false);
  h.sessions.set('main', summary('main'));
  h.sessions.set('worker', summary('worker'));
  await h.projects.userStopped('main');
  for (let index = 0; index < LEDGER_LIMITS.inbox; index += 1)
    assert.equal(await h.projects.send('main', 'worker', `Task ${index}`), 'queued');
  const replies: ServerEvent[] = [];
  const handle = createProjectCommandHandler(Promise.resolve(h.projects), (event) =>
    replies.push(event),
  );
  await handle({ type: 'project.pause', requestId: 'resume', projectId: saved.id, paused: false });
  assert.deepEqual(replies, [
    { type: 'project.result', requestId: 'resume', projectId: saved.id, ok: true },
  ]);
  assert.equal(h.projects.list()[0]?.paused, false);
  assert.equal(h.state.saved[0]?.paused, false);
  assert.equal(h.state.saved[0]?.pending.length, LEDGER_LIMITS.inbox);
  assert.equal(h.projects.listThreads('main').threads[0]?.unread, true);
  h.projects.historyReady();
  await drain();
  assert.equal(h.sent[0]?.id, 'worker');
});

test('Resume bounds its recovery reminder for 70 unread threads with maximal titles', async (t) => {
  const threads: Project['threads'] = Array.from({ length: 70 }, (_, index) => ({
    appSessionId: `worker-${index}`,
    ownerAppSessionId: 'main',
    title: `Thread ${index} `.padEnd(LEDGER_LIMITS.title, 'x'),
    reply: 'Done',
    unread: true,
    waiting: false,
  }));
  const saved: Project = {
    id: 'project',
    title: 'Example',
    paused: true,
    launching: 0,
    plan: [],
    todos: [],
    pending: [],
    threads: [{ appSessionId: 'main', title: 'Main', reply: '', waiting: false }, ...threads],
  };
  const h = await harness(t, [saved], false);
  h.sessions.set('main', summary('main'));
  const replies: ServerEvent[] = [];
  const handle = createProjectCommandHandler(Promise.resolve(h.projects), (event) =>
    replies.push(event),
  );
  await handle({ type: 'project.pause', requestId: 'resume', projectId: saved.id, paused: false });
  assert.deepEqual(replies, [
    { type: 'project.result', requestId: 'resume', projectId: saved.id, ok: true },
  ]);
  assert.equal(h.state.saved[0]?.paused, false);
  assert.equal(h.projects.listThreads('main').threads.length, 70);
  const reminder = h.state.saved[0]?.pending[0]?.text;
  assert.ok(reminder && reminder.length <= LEDGER_LIMITS.text);
  assert.ok(threads.slice(0, 20).every((thread) => reminder.includes(thread.title)));
  assert.ok(!reminder.includes(threads[20].title));
  assert.match(reminder, /and 50 more/);
  h.projects.historyReady();
  await drain();
  assert.equal(h.sent.length, 1);
  assert.match(h.sent[0].prompt, /and 50 more/);
  assert.ok(!h.sent[0].prompt.includes(threads[20].title));
});

test('Resume after a held restart continues interrupted threads once, honoring queued instructions', async (t) => {
  const original = await harness(t);
  const { id, main } = await original.root();
  const worker = await original.projects.spawn(main, input);
  const instructed = await original.projects.spawn(main, { ...input, title: 'Tests' });
  await original.projects.setPaused(id, true);
  await original.projects.send(main, instructed.appSessionId, 'Finish the tests.');
  original.projects.close();

  const restored = await harness(t, original.state.saved, false);
  restored.sessions.set(main, summary(main));
  for (const thread of [worker, instructed])
    restored.sessions.set(thread.appSessionId, interruptedSummary(thread.appSessionId));
  restored.projects.historyReady();
  await drain();
  assert.equal(restored.sent.length, 0);
  assert.equal(
    restored.state.saved[0]?.pending.length,
    3,
    'Pause reports and instructions stay queued',
  );
  assert.equal(
    restored.state.saved[0]?.pending.filter((message) => message.kind === 'message').length,
    1,
    'recovery waits for Resume',
  );

  const replies: ServerEvent[] = [];
  const handle = createProjectCommandHandler(Promise.resolve(restored.projects), (event) =>
    replies.push(event),
  );
  await handle({ type: 'project.pause', requestId: 'resume', projectId: id, paused: false });
  await drain();
  assert.deepEqual(replies, [
    { type: 'project.result', requestId: 'resume', projectId: id, ok: true },
  ]);
  assert.equal(restored.sent.length, 3);
  assert.equal(
    restored.sent.filter(({ id }) => id === main).length,
    1,
    'retained reports wake the lead',
  );
  const continuation = restored.sent.find(({ id }) => id === worker.appSessionId);
  assert.match(continuation?.prompt ?? '', /DROIDEX restarted while you were working/);
  const instruction = restored.sent.find(({ id }) => id === instructed.appSessionId);
  assert.match(instruction?.prompt ?? '', /Finish the tests\./);
  assert.doesNotMatch(instruction?.prompt ?? '', /DROIDEX restarted/);

  await restored.finish(worker.appSessionId);
  await restored.finish(instructed.appSessionId);
  await restored.projects.setPaused(id, true);
  await restored.projects.setPaused(id, false);
  await drain();
  assert.equal(restored.sent.filter(({ id }) => id !== main).length, 2);
  assert.equal(restored.state.saved[0]?.pending.length, 0);
});

test('a thread stopped after a held restart stays stopped on Resume', async (t) => {
  const original = await harness(t);
  const { id, main } = await original.root();
  const worker = await original.projects.spawn(main, input);
  await original.projects.setPaused(id, true);
  original.projects.close();

  const restored = await harness(t, original.state.saved, false);
  restored.sessions.set(main, summary(main));
  restored.sessions.set(worker.appSessionId, interruptedSummary(worker.appSessionId));
  restored.projects.historyReady();
  await drain();
  await restored.projects.stop(main, worker.appSessionId);
  await restored.projects.setPaused(id, false);
  await drain();
  assert.equal(restored.sent.filter(({ id }) => id === worker.appSessionId).length, 0);
});
