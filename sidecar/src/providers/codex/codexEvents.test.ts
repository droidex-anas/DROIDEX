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

  for await (const event of session.stream('hello')) {
    assert.equal(event.transcript?.kind, 'status');
    assert.match(event.transcript?.text ?? '', /broken_probe/);
    break;
  }
});
