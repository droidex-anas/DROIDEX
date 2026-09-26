import assert from 'node:assert/strict';
import test from 'node:test';

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

test('thread start, resume and every turn carry the requested service tier including explicit off', async () => {
  const requests: { method: string; params: Record<string, unknown> }[] = [];
  const notifications = new Map<string, (params: unknown) => void>();
  const client = {
    onNotification: (method: string, handler: (params: unknown) => void) =>
      notifications.set(method, handler),
    onRequest: () => undefined,
    onClose: () => undefined,
    request: (method: string, params: Record<string, unknown>) => {
      if (method === 'skills/list') return Promise.resolve({ data: [] });
      if (method === 'plugin/installed') return Promise.resolve({ marketplaces: [] });
      if (method === 'app/list') return Promise.resolve({ data: [], nextCursor: null });
      requests.push({ method, params });
      if (method === 'thread/start' || method === 'thread/resume')
        return Promise.resolve({ thread: { id: 'thread-fast' }, model: 'model' });
      if (method === 'turn/start') {
        notifications.get('turn/completed')?.({
          threadId: 'thread-fast',
          turn: { id: 'turn-fast', status: 'completed' },
        });
        return Promise.resolve({ turn: { id: 'turn-fast' } });
      }
      return Promise.reject(new Error(`Unexpected request: ${method}`));
    },
  } as unknown as AppServerClient;
  const session = new CodexSession({
    appSessionId: 'app-fast',
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
