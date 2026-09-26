import assert from 'node:assert/strict';
import test from 'node:test';
import {
  SESSIONS_MCP_SERVER_NAME,
  sessionsGrantScope,
  shouldAutoApproveSessionsTool,
} from './sessionsMcpPolicy.js';

const LEVELS = ['off', 'low', 'medium', 'high'] as const;
const FREE = [
  'thread_send',
  'thread_read',
  'thread_configure',
  'thread_stop',
  'plan_set',
  'session_list',
  'session_read',
];
const ASKS_BELOW_HIGH = ['thread_spawn', 'session_send', 'session_stop', 'session_mark'];

test('steering its own threads and reading the sidebar never ask; acting on another chat asks below High', () => {
  for (const autonomy of LEVELS) {
    for (const tool of FREE) {
      assert.equal(shouldAutoApproveSessionsTool(SESSIONS_MCP_SERVER_NAME, tool, autonomy), true);
      assert.equal(
        shouldAutoApproveSessionsTool(SESSIONS_MCP_SERVER_NAME, tool, autonomy, true),
        true,
      );
    }
    for (const tool of ASKS_BELOW_HIGH) {
      assert.equal(
        shouldAutoApproveSessionsTool(SESSIONS_MCP_SERVER_NAME, tool, autonomy),
        autonomy === 'high',
      );
      // Nobody watches an unattended run, so High does not act on other chats for it.
      assert.equal(
        shouldAutoApproveSessionsTool(SESSIONS_MCP_SERVER_NAME, tool, autonomy, true),
        false,
      );
    }
  }
  // Each harness namespaces the tool its own way.
  assert.equal(shouldAutoApproveSessionsTool('', 'droidex_sessions___thread_read', 'off'), true);
  assert.equal(
    shouldAutoApproveSessionsTool('', 'mcp__droidex-sessions__thread_read', 'off'),
    true,
  );
});

test('only the named session tools on the sessions server are ever approved', () => {
  for (const tool of ['constructor', '__proto__', 'toString', 'hasOwnProperty', 'thread_delete']) {
    assert.equal(shouldAutoApproveSessionsTool(SESSIONS_MCP_SERVER_NAME, tool, 'high'), false);
  }
  for (const server of ['droidex-automations', 'my-sessions', '']) {
    assert.equal(shouldAutoApproveSessionsTool(server, 'thread_read', 'high'), false);
  }
});

test('one Always allow for thread_spawn covers only the kind of chat it was given for', () => {
  const scope = (input: Record<string, unknown>) =>
    sessionsGrantScope(SESSIONS_MCP_SERVER_NAME, 'thread_spawn', input);
  assert.equal(scope({ reportBack: true }), 'thread');
  assert.equal(scope({ reportBack: false }), 'chat');
  // Without a kind there is nothing a grant could be scoped to.
  assert.equal(scope({}), '');
  assert.equal(sessionsGrantScope(SESSIONS_MCP_SERVER_NAME, 'thread_read', {}), undefined);
  assert.equal(
    sessionsGrantScope('droidex-automations', 'thread_spawn', { reportBack: true }),
    undefined,
  );
});

test('one Always allow for a message or a stop covers one chat, and for a mark the exact call', () => {
  const scope = (tool: string, input: Record<string, unknown>) =>
    sessionsGrantScope(SESSIONS_MCP_SERVER_NAME, tool, input);
  assert.equal(scope('session_send', { sessionId: 'chat-a', text: 'hi' }), 'chat-a');
  assert.equal(scope('session_send', { sessionId: 'chat-b', text: 'hi' }), 'chat-b');
  assert.equal(scope('session_stop', { sessionId: 'chat-a' }), 'chat-a');
  assert.equal(scope('session_send', { text: 'no target' }), '');
  assert.equal(
    scope('session_mark', { mark: 'archived', sessionIds: ['chat-b', 'chat-a', 'chat-b'] }),
    'archived:chat-a,chat-b',
  );
  assert.equal(
    scope('session_mark', { mark: 'settled', sessionIds: ['chat-a', 'chat-b'] }),
    'settled:chat-a,chat-b',
  );
  assert.equal(scope('session_mark', { mark: 'archived', sessionIds: [] }), '');
  assert.equal(scope('session_mark', { mark: 'archived', sessionIds: [7] }), '');
  // Reading changes nothing, so its grant is the whole tool, as it always was.
  assert.equal(scope('session_read', { sessionId: 'chat-a' }), undefined);
});
