import assert from 'node:assert/strict';
import test from 'node:test';
import { initialState, reducer } from './useStore';
import { createTargetKeySelector } from './useChatPullRequests';
import { sessionSummary } from '../test/sessionSummary';

test('discovery target keys ignore token changes and change for cwd, visibility, and active chat', () => {
  const session = sessionSummary('chat', {
    title: 'Chat',
    cwd: '/worktree',
    autonomy: 'off',
    phase: 'completed',
  });
  const state = { ...initialState, sessions: { chat: session }, chatMetadata: {} };
  const select = createTargetKeySelector();
  const key = select(state);
  assert.equal(select({ ...state, sessions: { chat: { ...session, tokensIn: 100 } } }), key);
  assert.notEqual(select({ ...state, sessions: { chat: { ...session, cwd: '/other' } } }), key);
  assert.notEqual(select(reducer(state, { type: 'ARCHIVE_CHAT', appSessionId: 'chat' })), key);
  assert.notEqual(select({ ...state, activeAppSessionId: 'chat' }), key);
});
