import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { AppServerClient } from './appServer.js';
import { CodexEventMapper, mcpServerFailure } from './codexEvents.js';
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
  const notifications = new Map<string, (params: unknown) => void>();
  const client = {
    onNotification: (method: string, handler: (params: unknown) => void) => {
      notifications.set(method, handler);
    },
    onRequest: () => undefined,
    onUnsupportedRequest: () => undefined,
    onClose: () => undefined,
    notify: () => undefined,
    request: (method: string) => {
      if (method === 'thread/start') return Promise.resolve({ thread: { id: 'thread-1' } });
      if (method === 'turn/start') return Promise.resolve({ turn: { id: 'turn-1' } });
      if (method === 'skills/list') return Promise.resolve({ data: [] });
      if (method === 'plugin/installed') return Promise.resolve({ marketplaces: [] });
      return Promise.resolve({ data: [], nextCursor: null });
    },
  } as unknown as AppServerClient;

  const session = new CodexSession({
    appSessionId: 'app-1',
    client,
    cwd: '/tmp',
    autonomy: 'low',
    model: {},
    interactions: {
      requestApproval: () => Promise.reject(new Error('unused')),
      requestQuestion: () => Promise.reject(new Error('unused')),
      cancelPending: () => undefined,
    },
  });
  await session.open();
  notifications.get('mcpServer/startupStatus/updated')?.(FAILED);

  const events = session.stream('hello');
  const first = await events.next();
  assert.ok(!first.done, 'the turn ended without reporting the failed server');
  assert.equal(first.value.transcript?.kind, 'status');
  assert.match(first.value.transcript?.text ?? '', /broken_probe/);
  await events.return(undefined);
});

test('edits-only checks workspace paths and keeps the running turn permission snapshot', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'codex-permissions-'));
  const cwd = join(directory, 'workspace');
  mkdirSync(cwd);
  mkdirSync(join(cwd, '.git'));
  symlinkSync(directory, join(cwd, 'escape'));
  symlinkSync(join(directory, 'missing'), join(cwd, 'dangling'));
  const notifications = new Map<string, (params: unknown) => void>();
  const requests = new Map<string, (params: unknown) => Promise<unknown>>();
  const starts: Record<string, unknown>[] = [];
  let asked = 0;
  let turnNumber = 0;
  let markStarted: () => void = () => undefined;
  const client = {
    onNotification: (method: string, handler: (params: unknown) => void) =>
      notifications.set(method, handler),
    onRequest: (method: string, handler: (params: unknown) => Promise<unknown>) =>
      requests.set(method, handler),
    onClose: () => undefined,
    notify: () => undefined,
    close: async () => undefined,
    request: async (method: string, params: Record<string, unknown>) => {
      if (method === 'thread/resume') {
        starts.push(params);
        return { thread: { id: 'thread-1' }, model: 'model' };
      }
      if (method === 'turn/start') {
        starts.push(params);
        turnNumber += 1;
        markStarted();
        return { turn: { id: `turn-${turnNumber}` } };
      }
      if (method === 'plugin/installed') return { marketplaces: [] };
      return { data: [], nextCursor: null };
    },
  } as unknown as AppServerClient;
  const session = new CodexSession({
    appSessionId: 'app-1',
    client,
    cwd,
    autonomy: 'low',
    model: {},
    interactions: {
      requestApproval: async () => {
        asked += 1;
        return 'cancel';
      },
      requestQuestion: async () => ({ cancelled: true, answers: [] }),
      cancelPending: () => undefined,
    },
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
            { path, kind: { type: 'update', ...(movePath ? { movePath } : {}) }, diff: '+ edit' },
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
    assert.equal(asked, 8);
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
