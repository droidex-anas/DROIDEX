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

test('running Codex approvals grant only confirmed escalations, keep failed downgrades and serialize settings', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'codex-permissions-'));
  const cwd = join(directory, 'workspace');
  mkdirSync(cwd);
  mkdirSync(join(cwd, '.git'));
  symlinkSync(directory, join(cwd, 'escape'));
  symlinkSync(join(directory, 'missing'), join(cwd, 'dangling'));
  const starts: Record<string, unknown>[] = [];
  const interrupted: unknown[] = [];
  const settingsWrites: Record<string, unknown>[] = [];
  let nativeSettings: Record<string, unknown> | undefined;
  let refuseHigh = false;
  let nextSettingsWrite:
    | {
        started: () => void;
        result: Promise<void>;
      }
    | undefined;
  const deferSettings = () => {
    let markStarted: () => void = () => undefined;
    const started = new Promise<void>((resolve) => {
      markStarted = resolve;
    });
    let resolve: () => void = () => undefined;
    let reject: (error: Error) => void = () => undefined;
    const result = new Promise<void>((done, fail) => {
      resolve = done;
      reject = fail;
    });
    nextSettingsWrite = { started: markStarted, result };
    return { started, resolve, reject };
  };
  let asked = 0;
  let turnNumber = 0;
  let markStarted: () => void = () => undefined;
  const { client, notifications, requests } = fakeClient((method, params) => {
    if (method === 'turn/interrupt') interrupted.push(params.turnId);
    if (method === 'thread/settings/update') {
      settingsWrites.push(params);
      const write = nextSettingsWrite;
      nextSettingsWrite = undefined;
      write?.started();
      return (write?.result ?? Promise.resolve()).then(() => {
        if (refuseHigh && params.approvalPolicy === 'never') throw new Error('refused');
        nativeSettings = params;
      });
    }
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
  const voiceEvents: string[] = [];
  const unsubscribeVoice = session.voice.onEvent((event) => voiceEvents.push(event.kind));
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
    assert.deepEqual(await approval('still-this-turn.ts'), { decision: 'cancel' });
    await session.setAutonomy('low');
    assert.deepEqual(await approval('accept-edits-now.ts'), { decision: 'accept' });
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
    assert.equal(asked, 10);
    refuseHigh = true;
    const rejectedEscalation = deferSettings();
    const writesBefore = settingsWrites.length;
    const rejected = session.setAutonomy('high');
    const refusal = assert.rejects(rejected, /refused/);
    const modelUpdate = session.setModel({ modelId: 'updated-model' });
    await rejectedEscalation.started;
    assert.equal(settingsWrites.length, writesBefore + 1);
    assert.deepEqual(await approval('../unconfirmed-full-access.ts'), { decision: 'cancel' });
    rejectedEscalation.reject(new Error('refused'));
    await refusal;
    await modelUpdate;
    assert.equal(nativeSettings?.model, 'updated-model');
    assert.equal(nativeSettings?.approvalPolicy, 'untrusted');
    assert.deepEqual(nativeSettings?.sandboxPolicy, {
      type: 'workspaceWrite',
      writableRoots: [],
      networkAccess: false,
      excludeTmpdirEnvVar: false,
      excludeSlashTmp: false,
    });
    assert.deepEqual(await approval('../rejected-full-access.ts'), { decision: 'cancel' });

    refuseHigh = false;
    const escalation = deferSettings();
    const raised = session.setAutonomy('high');
    await escalation.started;
    assert.deepEqual(await approval('../pending-full-access.ts'), { decision: 'cancel' });
    const asksBeforeFullAccess = asked;
    escalation.resolve();
    await raised;
    assert.deepEqual(await approval('../full-access.ts'), { decision: 'accept' });
    assert.deepEqual(
      await requests.get('item/commandExecution/requestApproval')?.({
        threadId: 'thread-1',
        turnId: 'turn-1',
        itemId: 'exec-full',
        command: 'pwd',
      }),
      { decision: 'accept' },
    );
    assert.equal(asked, asksBeforeFullAccess);
    await session.voice.start({ sdp: 'offer', attempt: 'voice-1' });
    assert.equal(session.voice.isLive(), true);
    const downgrade = deferSettings();
    const lowered = session.setAutonomy('off');
    // Revocation precedes even the start of the queued native write.
    assert.deepEqual(await approval('pending-supervised.ts'), { decision: 'cancel' });
    await downgrade.started;
    downgrade.reject(new Error('refused'));
    await lowered;
    assert.deepEqual(interrupted, ['turn-1']);
    assert.equal(session.voice.isLive(), false);
    assert.deepEqual(voiceEvents, ['closed']);
    assert.equal(nativeSettings?.approvalPolicy, 'untrusted');
    assert.deepEqual(await approval('failed-supervised.ts'), { decision: 'cancel' });
    await session.setModel({ reasoningEffort: 'high' });
    assert.equal(nativeSettings?.approvalPolicy, 'untrusted');
    assert.deepEqual(nativeSettings?.sandboxPolicy, { type: 'readOnly', networkAccess: false });
    await stream.return(undefined);
  } finally {
    unsubscribeVoice();
    await session.close();
    rmSync(directory, { recursive: true, force: true });
  }
});

test('Codex skips queued High after Off, including behind a model write', async () => {
  const writes: Record<string, unknown>[] = [];
  let release = () => {};
  let markStarted = () => {};
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  const started = new Promise<void>((resolve) => {
    markStarted = resolve;
  });
  let hold = false;
  const { client } = fakeClient(async (method, params) => {
    if (method === 'thread/start') return { thread: { id: 'thread-1' }, model: 'model' };
    if (method === 'thread/settings/update') {
      writes.push(params);
      if (hold) {
        hold = false;
        markStarted();
        await held;
      }
    }
  });
  const session = codexSession(client, 'app-1');
  await session.open();
  writes.length = 0;
  hold = true;
  const medium = session.setAutonomy('medium');
  await started;
  assert.equal(session.autonomy, 'low');
  const model = session.setModel({ modelId: 'updated' });
  const high = session.setAutonomy('high');
  const off = session.setAutonomy('off');
  assert.equal(session.autonomy, 'off');
  release();
  await Promise.all([medium, model, high, off]);
  assert.ok(writes.every((params) => params.approvalPolicy !== 'never'));
  assert.deepEqual(writes.at(-1)?.sandboxPolicy, { type: 'readOnly', networkAccess: false });
  assert.equal(writes.at(-1)?.model, 'updated');
  assert.equal(session.autonomy, 'off');
  await session.close();
});

test('Codex closes the provider runtime when a refused downgrade cannot be contained', async () => {
  for (const interruptFails of [true, false]) {
    let refuseOff = false;
    let closes = 0;
    let turns = 0;
    let interrupts = 0;
    const { client, notifications } = fakeClient((method, params) => {
      if (method === 'thread/start') return { thread: { id: 'thread-1' }, model: 'model' };
      if (method === 'thread/settings/update' && refuseOff && params.approvalPolicy === 'untrusted')
        throw new Error('revocation refused');
      if (method === 'turn/interrupt') {
        interrupts += 1;
        if (interruptFails) throw new Error('interrupt refused');
      }
      if (method === 'turn/start') turns += 1;
    });
    client.close = async () => {
      closes += 1;
    };
    const session = codexSession(client, 'app-1');
    await session.open();
    await session.setAutonomy('high');
    notifications.get('turn/started')?.({ threadId: 'thread-1', turn: { id: 'spoken-1' } });
    refuseOff = true;
    await assert.rejects(session.setAutonomy('off'), /revocation refused/);
    assert.equal(closes, 1);
    assert.equal(session.isClosed, true);
    assert.equal(session.autonomy, 'off');
    assert.ok(interrupts > 0);
    await session.closed;
    const next = session.stream('blocked');
    await assert.rejects(next.next());
    assert.equal(turns, 0);
  }
});
