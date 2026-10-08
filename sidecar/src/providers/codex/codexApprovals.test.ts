import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CodexEventMapper } from './codexEvents.js';
import { OpenPrompts } from './codexApprovals.js';
import type { ServerEvent } from '../../protocol.js';
import type { ProviderApprovalRequest } from '../interactions.js';
import { CodexSession } from './codexSession.js';
import { SessionInteractions } from '../../SessionInteractions.js';
import { sessionSummary } from '../../testing/sessionSummaryFixture.js';
import { codexSession, fakeClient } from '../../testing/codexClientFixture.js';

test('Codex approvals retain file diffs and questions retain answer arrays', async () => {
  const mapper = new CodexEventMapper('app');
  const changes = [{ path: '/workspace/a.ts', kind: { type: 'update' }, diff: '-old\n+new' }];
  mapper.map('item/started', {
    item: { type: 'fileChange', id: 'edit', changes, status: 'inProgress' },
  });
  assert.equal(mapper.toolDetail('edit')?.diff, '-old\n+new');
  mapper.map('item/fileChange/patchUpdated', {
    itemId: 'edit',
    changes: [{ ...changes[0], diff: '-old\n+updated' }],
  });
  const handlers = new Map<string, (params: unknown) => Promise<unknown>>();
  const approvals: ProviderApprovalRequest[] = [];
  const prompts = new OpenPrompts('app', {
    requestApproval: async (approval) => {
      approvals.push(approval);
      return 'refuse';
    },
    requestQuestion: async (questions) => {
      assert.deepEqual(questions, [
        {
          index: 0,
          question: 'Pick features',
          header: 'Features',
          multiSelect: true,
          options: [{ label: 'Search', description: 'Find records' }],
        },
      ]);
      return {
        cancelled: false,
        answers: [
          {
            index: 0,
            question: 'Pick features',
            selected: ['Search', 'Export'],
            custom: 'Offline',
          },
        ],
      };
    },
    isActive: () => true,
    cancelPending: () => undefined,
  });
  prompts.register(
    {
      onRequest: (method, handler) => {
        handlers.set(method, handler);
      },
    },
    (id) => mapper.toolDetail(id),
    () => false,
    () => false,
  );
  const approve = handlers.get('item/fileChange/requestApproval');
  assert.ok(approve);
  assert.deepEqual(await approve({ itemId: 'edit', reason: 'Update the file' }), {
    decision: 'decline',
  });
  assert.equal(approvals[0].request.detail, '/workspace/a.ts');
  assert.equal(approvals[0].request.title, 'Update the file');
  assert.equal(approvals[0].request.diff, '-old\n+updated');
  // A file Codex adds arrives as bare content; the card is given diff lines.
  mapper.map('item/started', {
    item: {
      type: 'fileChange',
      id: 'add',
      changes: [{ path: '/workspace/new.txt', kind: { type: 'add' }, diff: 'hello\nthere\n' }],
      status: 'inProgress',
    },
  });
  assert.equal(mapper.toolDetail('add')?.diff, '@@ -0,0 +1,2 @@\n+hello\n+there');
  assert.equal(approvals[0].request.canAlwaysAllow, true);
  assert.match(approvals[0].request.requestId, /^req-/);
  const ask = handlers.get('item/tool/requestUserInput');
  assert.ok(ask);
  assert.deepEqual(
    await ask({
      questions: [
        {
          id: 'features',
          question: 'Pick features',
          header: 'Features',
          multiSelect: true,
          options: [{ label: 'Search', description: 'Find records' }],
        },
      ],
    }),
    { answers: { features: { answers: ['Search', 'Export', 'Offline'] } } },
  );
});

test('thread start, resume and every turn carry the requested service tier including explicit off', async () => {
  const requests: { method: string; params: Record<string, unknown> }[] = [];
  const { client, notifications } = fakeClient((method, params) => {
    // The model and effort travel separately; only the tier is under test here.
    if (
      method === 'app/list' ||
      method === 'account/rateLimits/read' ||
      method === 'thread/settings/update'
    )
      return undefined;
    requests.push({ method, params });
    if (method === 'thread/start' || method === 'thread/resume')
      return { thread: { id: 'thread-fast' }, model: 'model' };
    if (method === 'turn/start') {
      notifications.get('turn/completed')?.({
        threadId: 'thread-fast',
        turn: { id: 'turn-fast', status: 'completed' },
      });
      return { turn: { id: 'turn-fast' } };
    }
    throw new Error(`Unexpected request: ${method}`);
  });
  const session = codexSession(client, 'app-fast');
  await session.open();
  await session.setModel({ fastMode: true });
  await session.open('thread-fast');
  for await (const event of session.stream('first')) assert.equal(event.done, true);
  await session.setModel({ reasoningEffort: 'high' });
  for await (const event of session.stream('second')) assert.equal(event.done, true);
  await session.setModel({ fastMode: false });
  for await (const event of session.stream('third')) assert.equal(event.done, true);
  await session.open('thread-fast');
  assert.deepEqual(
    requests.map(({ method, params }) => [method, params.serviceTier]),
    [
      ['thread/start', 'default'],
      ['thread/resume', 'priority'],
      ['turn/start', 'priority'],
      ['turn/start', 'priority'],
      ['turn/start', 'default'],
      ['thread/resume', 'default'],
    ],
  );
});

test('running Codex approvals follow current autonomy and settle eligible pending requests', async (t) => {
  const emitted: ServerEvent[] = [];
  const live = { summary: sessionSummary({ appSessionId: 'app-1', provider: 'codex' }) };
  const interactions = new SessionInteractions({
    getLiveSession: () => live,
    updateSummary: (_id, patch) => Object.assign(live.summary, patch),
    setProviderSpecMode: async () => undefined,
    emit: (event) => emitted.push(event),
    emitError: (error) => assert.fail(error.message),
  });
  const methods: string[] = [];
  const { client, notifications, requests } = fakeClient((method, params) => {
    methods.push(method);
    if (method === 'thread/start') return { thread: { id: 'thread-1' }, model: 'model' };
    if (method === 'turn/start') {
      assert.equal(params.approvalPolicy, 'untrusted');
      return { turn: { id: 'turn-1' } };
    }
    return undefined;
  });
  const session = new CodexSession({
    appSessionId: 'app-1',
    client,
    cwd: '/tmp',
    autonomy: 'low',
    model: {},
    interactions: interactions.interactionsFor({ id: 'app-1' }),
  });
  await session.open();
  const stream = session.stream('search');
  t.after(async () => {
    await stream.return(undefined);
    await session.close();
  });
  const first = stream.next();
  notifications.get('item/started')?.({
    threadId: 'thread-1',
    item: { type: 'commandExecution', id: 'exec', command: 'rg --files', status: 'inProgress' },
  });
  await first;
  const approve = requests.get('item/commandExecution/requestApproval');
  assert.ok(approve);
  const request = { threadId: 'thread-1', turnId: 'turn-1', itemId: 'exec', command: 'rg --files' };
  const pending = approve(request);
  assert.equal(emitted.at(-1)?.type, 'approval.requested');
  await session.setAutonomy('medium');
  assert.equal(interactions.hasPendingApproval('app-1'), true);
  await session.setAutonomy('high');
  assert.equal(interactions.hasPendingApproval('app-1'), false);
  assert.deepEqual(await pending, { decision: 'accept' });
  assert.equal(emitted.at(-1)?.type, 'interaction.cancelled');
  const count = emitted.length;
  assert.deepEqual(await approve(request), { decision: 'accept' });
  assert.equal(emitted.length, count, 'high autonomy must not reach the user');
  for (const autonomy of ['low', 'medium'] as const) {
    await session.setAutonomy(autonomy);
    const answer = approve(request);
    const event = emitted.at(-1);
    assert.equal(event?.type, 'approval.requested');
    if (event?.type !== 'approval.requested') throw new Error('Missing approval');
    await interactions.respondToApproval('app-1', event.request.requestId, 'refuse');
    assert.deepEqual(await answer, { decision: 'decline' });
  }
  assert.equal(methods.filter((method) => method === 'turn/start').length, 1);
  assert.equal(methods.includes('turn/interrupt'), false);
});

test('edits-only checks workspace paths and follows current approval autonomy', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'codex-permissions-'));
  const cwd = join(directory, 'workspace');
  mkdirSync(cwd);
  mkdirSync(join(cwd, '.git'));
  symlinkSync(directory, join(cwd, 'escape'));
  symlinkSync(join(directory, 'missing'), join(cwd, 'dangling'));
  const starts: Record<string, unknown>[] = [];
  let asked = 0;
  let turnNumber = 0;
  let markStarted: () => void = () => undefined;
  const { client, notifications, requests } = fakeClient((method, params) => {
    if (method === 'thread/resume') {
      starts.push(params);
      return { thread: { id: 'thread-1' }, model: 'model' };
    }
    if (method !== 'turn/start') return undefined;
    starts.push(params);
    turnNumber += 1;
    markStarted();
    return { turn: { id: `turn-${String(turnNumber)}` } };
  });
  const session = codexSession(client, 'app-1', cwd, async () => {
    asked += 1;
    return 'cancel';
  });
  try {
    await session.open('thread-1');
    assert.equal(starts[0]?.approvalPolicy, 'untrusted');
    assert.equal(starts[0]?.sandbox, 'workspace-write');
    const started = new Promise<void>((resolve) => {
      markStarted = resolve;
    });
    const stream = session.stream('edit');
    const first = stream.next();
    await started;
    notifications.get('turn/started')?.({ threadId: 'thread-1', turn: { id: 'turn-1' } });
    let itemNumber = 0;
    const approval = async (path: string, movePath?: string) => {
      const itemId = `edit-${++itemNumber}`;
      notifications.get('item/started')?.({
        threadId: 'thread-1',
        item: {
          type: 'fileChange',
          id: itemId,
          status: 'inProgress',
          changes: [
            { path, kind: { type: 'update', move_path: movePath ?? null }, diff: '+ edit' },
          ],
        },
      });
      return requests.get('item/fileChange/requestApproval')?.({
        threadId: 'thread-1',
        turnId: 'turn-1',
        itemId,
      });
    };
    assert.deepEqual(await approval('src/new.ts'), { decision: 'accept' });
    await first;
    for (const path of [
      '../outside',
      '.git/config',
      '.codex/config.toml',
      '.agents/rules',
      'escape/file',
      'escape/../beside-the-workspace',
      'dangling',
    ]) {
      assert.deepEqual(await approval(path), { decision: 'cancel' });
    }
    assert.deepEqual(await approval('inside.ts', '../renamed.ts'), { decision: 'cancel' });
    assert.deepEqual(
      await requests.get('item/commandExecution/requestApproval')?.({
        itemId: 'exec',
        command: 'pwd',
      }),
      { decision: 'cancel' },
    );
    await session.setAutonomy('off');
    assert.deepEqual(await approval('still-this-turn.ts'), { decision: 'cancel' });
    assert.equal(asked, 10);
    await stream.return(undefined);
    const nextStarted = new Promise<void>((resolve) => {
      markStarted = resolve;
    });
    const second = session.stream('next');
    const next = second.next();
    await nextStarted;
    assert.equal(starts[2]?.approvalPolicy, 'untrusted');
    assert.deepEqual(starts[2]?.sandboxPolicy, { type: 'readOnly', networkAccess: false });
    notifications.get('turn/completed')?.({
      threadId: 'thread-1',
      turn: { id: 'turn-2', status: 'completed' },
    });
    await next;
    await second.return(undefined);
  } finally {
    await session.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test('a model write racing a lowered autonomy cannot restore the old level on the thread', async () => {
  const writes: unknown[] = [];
  let gate: Promise<void> | undefined;
  let release: (() => void) | undefined;
  const { client } = fakeClient((method, params) => {
    if (method === 'thread/start') return { thread: { id: 'thread-1' }, model: 'model' };
    if (method !== 'thread/settings/update') return undefined;
    writes.push(params.approvalPolicy);
    // The raise waits, so the lowering and the model write queue behind it.
    const held = gate;
    gate = undefined;
    return held;
  });
  const session = codexSession(client, 'app-1');
  await session.open();
  writes.length = 0;
  gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const raised = session.setAutonomy('high');
  const lowered = session.setAutonomy('off');
  const model = session.setModel({ modelId: 'other' });
  release?.();
  await Promise.all([raised, lowered, model]);
  // Every write carries the latest level asked for, so the thread never goes
  // back to acting unattended once Off has been chosen.
  assert.equal(writes.length, 3);
  assert.ok(!writes.includes('never'));
});

test('a refused autonomy raise puts the previous level back on the thread', async () => {
  const writes: unknown[] = [];
  let failNext = false;
  const { client } = fakeClient((method, params) => {
    if (method === 'thread/start') return { thread: { id: 'thread-1' }, model: 'model' };
    if (method !== 'thread/settings/update') return undefined;
    writes.push(params.approvalPolicy);
    if (failNext) {
      failNext = false;
      return Promise.reject(new Error('refused'));
    }
    return undefined;
  });
  const session = codexSession(client, 'app-1');
  await session.open();
  writes.length = 0;
  failNext = true;
  const raised = session.setAutonomy('high');
  const model = session.setModel({ modelId: 'other' });
  await assert.rejects(raised);
  await model;
  // Whatever ran in between, the thread ends on the level the chat still has.
  assert.equal(writes.at(-1), 'untrusted');
});
