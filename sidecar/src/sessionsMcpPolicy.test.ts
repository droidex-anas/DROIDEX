import assert from 'node:assert/strict';
import test from 'node:test';
import {
  SESSIONS_MCP_SERVER_NAME,
  sessionsGrantScope,
  shouldAutoApproveSessionsTool,
} from './sessionsMcpPolicy.js';

const LEVELS = ['off', 'low', 'medium', 'high'] as const;
const STEERING = ['thread_send', 'thread_read', 'thread_configure', 'thread_stop', 'plan_set'];

test("steering this chat's own threads never asks, starting a chat asks below High", () => {
  for (const autonomy of LEVELS) {
    for (const tool of STEERING) {
      assert.equal(shouldAutoApproveSessionsTool(SESSIONS_MCP_SERVER_NAME, tool, autonomy), true);
      assert.equal(
        shouldAutoApproveSessionsTool(SESSIONS_MCP_SERVER_NAME, tool, autonomy, true),
        true,
      );
    }
    assert.equal(
      shouldAutoApproveSessionsTool(SESSIONS_MCP_SERVER_NAME, 'thread_spawn', autonomy),
      autonomy === 'high',
    );
  }
  // Nobody watches an unattended run, so High does not start chats for it.
  assert.equal(
    shouldAutoApproveSessionsTool(SESSIONS_MCP_SERVER_NAME, 'thread_spawn', 'high', true),
    false,
  );
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
