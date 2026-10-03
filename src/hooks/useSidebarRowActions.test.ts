import assert from 'node:assert/strict';
import test from 'node:test';
import { rowMenuTarget } from './useSidebarRowActions';
import { sessionSummary } from '../test/sessionSummary';

test('row menus reject missing and hidden targets during render', () => {
  assert.equal(rowMenuTarget({}, { appSessionId: 'gone' }, {}), null);
  const session = sessionSummary('chat', {
    title: 'Chat',
    cwd: '/worktree',
    autonomy: 'off',
    phase: 'completed',
  });
  const sessions = { chat: session };
  assert.equal(rowMenuTarget(sessions, { appSessionId: 'chat' }, {}), session);
  assert.equal(
    rowMenuTarget(sessions, { appSessionId: 'chat' }, { chat: { archivedAt: 1 } }),
    null,
  );
  assert.equal(rowMenuTarget(sessions, { appSessionId: 'chat' }, { chat: { deletedAt: 1 } }), null);
  assert.equal(rowMenuTarget(sessions, null, {}), null);
});
