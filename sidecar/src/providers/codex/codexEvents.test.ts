import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { AppServerClient } from './appServer.js';
import { CodexEventMapper, mcpServerFailure } from './codexEvents.js';
import { OpenPrompts } from './codexApprovals.js';
import type { PermissionOutcome } from '../../protocol.js';
import type { ProviderApprovalRequest } from '../interactions.js';
import { CodexSession } from './codexSession.js';

// Exactly what `codex app-server` sends for a server whose command is missing.
const FAILED = {
  threadId: 'thread-1',
  name: 'broken_probe',
  status: 'failed',
  error:
    'MCP client for `broken_probe` failed to start: MCP startup failed: No such file or directory (os error 2)',
  failureReason: null,
};
const STARTING = { ...FAILED, status: 'starting', error: null };

/**
 * An app-server client that records notification and request handlers and
 * answers requests with `request`, or with an empty catalog page.
 */
function fakeClient(request: (method: string, params: Record<string, unknown>) => unknown) {
  const notifications = new Map<string, (params: unknown) => void>();
  const requests = new Map<string, (params: unknown) => Promise<unknown>>();
  const client = {
    onNotification: (method: string, handler: (params: unknown) => void) =>
      notifications.set(method, handler),
    onRequest: (method: string, handler: (params: unknown) => Promise<unknown>) =>
      requests.set(method, handler),
    onUnsupportedRequest: () => undefined,
    onClose: () => undefined,
    notify: () => undefined,
    close: async () => undefined,
    request: async (method: string, params: Record<string, unknown>) => {
      if (method === 'skills/list') return { data: [] };
      if (method === 'plugin/installed') return { marketplaces: [] };
      return (await request(method, params)) ?? { data: [], nextCursor: null };
    },
  } as unknown as AppServerClient;
  return { client, notifications, requests };
}

function codexSession(
  client: AppServerClient,
  appSessionId: string,
  cwd = '/tmp',
  requestApproval: () => Promise<PermissionOutcome> = () => Promise.reject(new Error('unused')),
): CodexSession {
  return new CodexSession({
    appSessionId,
    client,
    cwd,
    autonomy: 'low',
    model: {},
    interactions: {
      requestApproval,
      requestQuestion: async () => ({ cancelled: true, answers: [] }),
      isActive: () => true,
      cancelPending: () => undefined,
    },
  });
}

test('a failed MCP server is read once per server, and its startup is not', () => {
  const mapper = new CodexEventMapper('app-1');

  assert.equal(mcpServerFailure(STARTING), undefined);
  assert.deepEqual(mcpServerFailure(FAILED), { name: 'broken_probe', detail: FAILED.error });

  const rows = mapper.mcpFailureEvents(mcpServerFailure(FAILED)!);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].transcript?.kind, 'status');
  assert.equal(rows[0].transcript?.isError, undefined);
  assert.equal(rows[0].transcript?.transient, undefined);
  assert.match(rows[0].transcript?.text ?? '', /broken_probe/);

  // The same server failing again is the same fact, not a second row.
  assert.deepEqual(mapper.mcpFailureEvents(mcpServerFailure(FAILED)!), []);
  assert.equal(mapper.mcpFailureEvents({ name: 'other' }).length, 1);
  assert.equal(
    mapper.mcpFailureEvents({ name: 'other-2' })[0].transcript?.text,
    'MCP server "other-2" failed to start.',
  );
});

// The servers start before the session's first turn, so the row has to survive
// the wait and reach the transcript that turn opens.
test('a server that failed before the first turn is still reported in it', async () => {
  const { client, notifications } = fakeClient((method) => {
    if (method === 'thread/start') return { thread: { id: 'thread-1' } };
    if (method === 'turn/start') return { turn: { id: 'turn-1' } };
    return undefined;
  });
  const session = codexSession(client, 'app-1');
  await session.open();
  notifications.get('mcpServer/startupStatus/updated')?.(FAILED);

  const events = session.stream('hello');
  const first = await events.next();
  assert.ok(!first.done, 'the turn ended without reporting the failed server');
  assert.equal(first.value.transcript?.kind, 'status');
  assert.match(first.value.transcript?.text ?? '', /broken_probe/);
  await events.return(undefined);
});

test('Codex steers wait for delivery and the RPC reply, and a new turn starts a fresh queue', async (t) => {
  const steers: Record<string, unknown>[] = [];
  // Codex never answers the first steer's request.
  const firstRequest = new Promise<void>(() => undefined);
  const { client, notifications } = fakeClient((method, params) => {
    if (method === 'thread/start') return { thread: { id: 'thread-1' } };
    if (method !== 'turn/steer') return undefined;
    steers.push(params);
    return steers.length === 1 ? firstRequest : undefined;
  });
  const session = codexSession(client, 'app-1');
  t.after(() => session.close());
  await session.open();
  notifications.get('turn/started')?.({ threadId: 'thread-1', turn: { id: 'turn-1' } });

  const first = session.steer('first');
  const second = session.steer('second');
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(steers.length, 1, 'the second request must wait for the first steer');
  assert.equal(steers[0].expectedTurnId, 'turn-1');

  notifications.get('item/started')?.({
    threadId: 'thread-1',
    item: { type: 'userMessage', clientId: steers[0].clientUserMessageId },
  });
  assert.equal(await first, true);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(steers.length, 1, 'an early delivery must still wait for the RPC reply');

  notifications.get('error')?.({
    threadId: 'thread-1',
    error: { message: 'Turn failed' },
    willRetry: false,
  });
  void session.steer('after failure');
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(steers.length, 1, 'a reset must invalidate its target');

  notifications.get('turn/completed')?.({
    threadId: 'thread-1',
    turn: { id: 'turn-1', status: 'completed' },
  });
  assert.equal(await second, false, 'a queued steer must not follow a replacement turn');
  notifications.get('turn/started')?.({ threadId: 'thread-1', turn: { id: 'turn-2' } });
  const third = session.steer('third');
  const fourth = session.steer('fourth');
  await new Promise((resolve) => setImmediate(resolve));
  // The first steer's reply never came; it named turn-1 and cannot hold turn-2 back.
  assert.equal(steers.length, 2, 'a new turn must not wait for a reply from the last one');
  assert.equal(steers[1].expectedTurnId, 'turn-2');
  assert.deepEqual(steers[1].input, [{ type: 'text', text: 'third' }]);
  notifications.get('item/started')?.({
    threadId: 'thread-1',
    item: { type: 'userMessage', clientId: steers[1].clientUserMessageId },
  });
  assert.equal(await third, true);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(steers.length, 3);
  assert.equal(steers[2].expectedTurnId, 'turn-2');
  notifications.get('item/started')?.({
    threadId: 'thread-1',
    item: { type: 'userMessage', clientId: steers[2].clientUserMessageId },
  });
  assert.equal(await fourth, true);
});

test('a delegated turn completing preserves the active typed turn steer queue', async (t) => {
  const steers: Record<string, unknown>[] = [];
  let releaseFirstRequest: () => void = () => undefined;
  const firstRequest = new Promise<void>((resolve) => {
    releaseFirstRequest = resolve;
  });
  const { client, notifications } = fakeClient((method, params) => {
    if (method === 'thread/start') return { thread: { id: 'thread-1' } };
    if (method === 'turn/start') return { turn: { id: 'typed-turn' } };
    if (method !== 'turn/steer') return undefined;
    steers.push(params);
    return steers.length === 1 ? firstRequest : undefined;
  });
  const session = codexSession(client, 'app-1');
  t.after(() => session.close());
  await session.open();
  const events = session.stream('hello');
  t.after(() => events.return(undefined));
  const firstEvent = events.next();
  notifications.get('item/agentMessage/delta')?.({
    threadId: 'thread-1',
    itemId: 'answer',
    delta: 'Working',
  });
  await firstEvent;

  const first = session.steer('first');
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(steers.length, 1);
  assert.equal(steers[0].expectedTurnId, 'typed-turn');
  notifications.get('turn/started')?.({
    threadId: 'thread-1',
    turn: { id: 'delegated-turn' },
  });
  notifications.get('turn/completed')?.({
    threadId: 'thread-1',
    turn: { id: 'delegated-turn', status: 'completed' },
  });
  const second = session.steer('second');
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(steers.length, 1, 'delegated completion must not release the typed queue');

  notifications.get('item/started')?.({
    threadId: 'thread-1',
    item: { type: 'userMessage', clientId: steers[0].clientUserMessageId },
  });
  assert.equal(await first, true, 'delegated completion must not drop a typed steer');
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(steers.length, 1, 'the second steer must still wait for the first RPC reply');
  releaseFirstRequest();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(steers.length, 2);
  assert.equal(steers[1].expectedTurnId, 'typed-turn');
  notifications.get('item/started')?.({
    threadId: 'thread-1',
    item: { type: 'userMessage', clientId: steers[1].clientUserMessageId },
  });
  assert.equal(await second, true);
});

test('a delegated turn starting preserves the typed turn accepted Stop', async (t) => {
  const steers: Record<string, unknown>[] = [];
  const { client, notifications } = fakeClient((method, params) => {
    if (method === 'thread/start') return { thread: { id: 'thread-1' } };
    if (method === 'turn/start') return { turn: { id: 'typed-turn' } };
    if (method === 'turn/steer') {
      steers.push(params);
      notifications.get('item/started')?.({
        threadId: 'thread-1',
        item: { type: 'userMessage', clientId: params.clientUserMessageId },
      });
    }
    return undefined;
  });
  const session = codexSession(client, 'app-1');
  t.after(() => session.close());
  await session.open();
  const events = session.stream('hello');
  t.after(() => events.return(undefined));
  const firstEvent = events.next();
  notifications.get('item/agentMessage/delta')?.({
    threadId: 'thread-1',
    itemId: 'answer',
    delta: 'Working',
  });
  await firstEvent;

  await session.interrupt();
  notifications.get('turn/started')?.({
    threadId: 'thread-1',
    turn: { id: 'delegated-turn' },
  });
  assert.equal(await session.steer('after Stop'), false);
  assert.equal(steers.length, 0, 'the accepted typed Stop must still block steering');
});

test('a delegated turn fatal error preserves the typed stream and steer queue', async (t) => {
  const steers: Record<string, unknown>[] = [];
  const { client, notifications } = fakeClient((method, params) => {
    if (method === 'thread/start') return { thread: { id: 'thread-1' } };
    if (method === 'turn/start') return { turn: { id: 'typed-turn' } };
    if (method === 'turn/steer') steers.push(params);
    return undefined;
  });
  const session = codexSession(client, 'app-1');
  t.after(() => session.close());
  await session.open();
  const events = session.stream('hello');
  t.after(() => events.return(undefined));
  const firstEvent = events.next();
  notifications.get('item/agentMessage/delta')?.({
    threadId: 'thread-1',
    itemId: 'answer',
    delta: 'Working',
  });
  await firstEvent;

  const first = session.steer('first');
  const second = session.steer('second');
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(steers.length, 1);
  notifications.get('turn/started')?.({
    threadId: 'thread-1',
    turn: { id: 'delegated-turn' },
  });
  notifications.get('error')?.({
    threadId: 'thread-1',
    turnId: 'delegated-turn',
    error: { message: 'Spoken request failed' },
    willRetry: false,
  });
  notifications.get('item/started')?.({
    threadId: 'thread-1',
    item: { type: 'userMessage', clientId: steers[0].clientUserMessageId },
  });
  assert.equal(await first, true, 'the delegated error must not drop the typed steer');
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(steers.length, 2);
  assert.equal(steers[1].expectedTurnId, 'typed-turn');
  notifications.get('item/started')?.({
    threadId: 'thread-1',
    item: { type: 'userMessage', clientId: steers[1].clientUserMessageId },
  });
  assert.equal(await second, true);

  notifications.get('turn/completed')?.({
    threadId: 'thread-1',
    turn: { id: 'typed-turn', status: 'completed' },
  });
  const remaining = [];
  for await (const event of events) remaining.push(event);
  assert.ok(
    remaining.some((event) => event.done),
    'the typed stream must complete normally',
  );
});

test('a refused Stop reopens steering only when no Stop was accepted for that turn', async (t) => {
  let releaseTurn: (response: { turn: { id: string } }) => void = () => undefined;
  const turnStart = new Promise<{ turn: { id: string } }>((resolve) => {
    releaseTurn = resolve;
  });
  let interrupts = 0;
  const { client, notifications } = fakeClient((method, params) => {
    if (method === 'thread/start') return { thread: { id: 'thread-1' } };
    if (method === 'turn/start') return turnStart;
    if (method === 'turn/steer') {
      notifications.get('item/started')?.({
        threadId: 'thread-1',
        item: { type: 'userMessage', clientId: params.clientUserMessageId },
      });
    }
    if (method === 'turn/interrupt') {
      interrupts += 1;
      if (interrupts === 1 || interrupts === 3) throw new Error('Stop refused');
    }
    return undefined;
  });
  const session = codexSession(client, 'app-1');
  t.after(() => session.close());
  await session.open();
  const events = session.stream('hello');
  const first = events.next();
  await session.interrupt();
  releaseTurn({ turn: { id: 'turn-1' } });
  await first;

  assert.equal(
    await session.steer('after refusal'),
    true,
    'a refused early Stop restores steering',
  );

  await session.interrupt();
  await assert.rejects(session.interrupt(), /Stop refused/);
  assert.equal(
    await session.steer('after duplicate'),
    false,
    'the accepted Stop still owns the turn',
  );
  await events.return(undefined);
});

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

test('edits-only checks workspace paths and keeps the running turn permission snapshot', async () => {
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
    await session.setAutonomy('off');
    assert.deepEqual(await approval('still-this-turn.ts'), { decision: 'accept' });
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
    assert.equal(asked, 9);
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
