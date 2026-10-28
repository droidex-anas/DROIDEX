import test from 'node:test';
import assert from 'node:assert/strict';

import { adaptEvent, initialState, reducer, toastMessageForEvent } from './useStore';
import { sessionSummary } from '../test/sessionSummary';

const session = sessionSummary('app-1', {
  providerSessionId: 'provider-1',
  title: 'Chat',
  workspaceKind: 'none',
  autonomy: 'medium',
  phase: 'running',
});

test('changing the default autonomy never rewrites an explicit draft override', () => {
  const drafted = reducer(initialState, { type: 'SET_DRAFT_AUTONOMY', autonomy: 'high' });
  const changed = reducer(drafted, { type: 'SET_DEFAULT_AUTONOMY', autonomy: 'off' });
  assert.equal(changed.draftAutonomy, 'high');
  assert.equal(changed.defaultAutonomy, 'off');
});

test('the draft override resets at every draft lifecycle point', () => {
  const drafted = reducer(initialState, { type: 'SET_DRAFT_AUTONOMY', autonomy: 'high' });
  assert.equal(drafted.draftAutonomy, 'high');

  const held = reducer(drafted, { type: 'HOLD_COMPOSE_ORIGIN', holdId: 'hold-1' });
  const pending = reducer(held, {
    type: 'SET_PENDING_COMPOSE',
    clientRef: 'c-1',
    text: 'start chat',
    skills: [],
    files: [],
    originHoldId: 'hold-1',
  });
  const created = reducer(pending, {
    type: 'SESSION_CREATED',
    clientRef: 'c-1',
    session,
  });
  assert.equal(created.draftAutonomy, null);

  const draftedAgain = reducer(drafted, { type: 'SET_DRAFT_AUTONOMY', autonomy: 'low' });
  const switched = reducer(draftedAgain, { type: 'SET_ACTIVE_SESSION', id: 'app-1' });
  assert.equal(switched.draftAutonomy, null);

  const draftedOnceMore = reducer(drafted, { type: 'SET_DRAFT_AUTONOMY', autonomy: 'off' });
  const newChat = reducer(draftedOnceMore, {
    type: 'START_CHAT',
    cwd: '/tmp',
    executionMode: 'worktree',
  });
  assert.equal(newChat.draftAutonomy, null);
});

test('autonomy summaries and older settlements never clear the latest pending request', () => {
  const requested = reducer(
    { ...initialState, sessions: { 'app-1': session } },
    {
      type: 'AUTONOMY_UPDATE_REQUESTED',
      appSessionId: 'app-1',
      requestId: 'raise-1',
      autonomy: 'high',
    },
  );
  const latest = { requestId: 'raise-1', autonomy: 'high' };
  assert.deepEqual(requested.pendingAutonomy['app-1'], latest);

  // Summaries carry current policy, not the identity of an in-flight write.
  for (const autonomy of ['medium', 'high', 'off'] as const) {
    const echo = reducer(requested, { type: 'SESSION_UPDATED', session: { ...session, autonomy } });
    assert.deepEqual(echo.pendingAutonomy['app-1'], latest);
    assert.equal(echo.sessions['app-1']?.autonomy, autonomy);
  }
  const failure = adaptEvent({
    type: 'error',
    code: 'session.autonomy_update_failed',
    appSessionId: 'app-1',
    requestId: 'revoke-0',
    message: 'Could not revoke autonomy',
    recoverable: true,
  });
  assert.ok(failure);
  assert.equal(reducer(requested, failure), requested);

  const applied = adaptEvent({
    type: 'session.autonomy_update_applied',
    appSessionId: 'app-1',
    requestId: 'revoke-0',
  });
  assert.ok(applied);
  assert.equal(reducer(requested, applied), requested);
  const confirmed = reducer(requested, { ...applied, requestId: 'raise-1' });
  assert.equal(confirmed.pendingAutonomy['app-1'], undefined);
});

test('closing a session drops its pending autonomy entry', () => {
  const requested = reducer(initialState, {
    type: 'AUTONOMY_UPDATE_REQUESTED',
    appSessionId: 'app-1',
    requestId: 'raise-1',
    autonomy: 'high',
  });
  const closed = reducer(requested, { type: 'SESSION_CLOSED', appSessionId: 'app-1' });
  assert.equal(closed.pendingAutonomy['app-1'], undefined);
});

test('a failed autonomy update settles its session and toasts; without a session it does nothing', () => {
  const failure = {
    type: 'error' as const,
    code: 'session.autonomy_update_failed',
    appSessionId: 'app-1',
    requestId: 'raise-1',
    message: 'Could not change autonomy: provider rejected the update',
    recoverable: true as const,
  };

  assert.equal(toastMessageForEvent(failure), failure.message);
  const action = adaptEvent(failure);
  assert.deepEqual(action, {
    type: 'AUTONOMY_UPDATE_SETTLED',
    appSessionId: 'app-1',
    requestId: 'raise-1',
  });

  const state = {
    ...initialState,
    sessions: { 'app-1': session },
    pendingAutonomy: { 'app-1': { requestId: 'raise-1', autonomy: 'high' as const } },
  };
  const next = reducer(state, action!);
  assert.equal(next.pendingAutonomy['app-1'], undefined);
  assert.equal(next.sessions['app-1']?.phase, 'running');
  assert.equal(next.sessions['app-1']?.autonomy, 'medium');

  assert.equal(adaptEvent({ ...failure, appSessionId: undefined }), null);
  assert.equal(adaptEvent({ ...failure, requestId: undefined }), null);
});

test('a runtime replacement drops lost autonomy writes and keeps requests resent to the new sidecar', () => {
  let state = initialState;
  for (const appSessionId of ['lost', 'resent', 'not-adopted']) {
    state = reducer(state, {
      type: 'AUTONOMY_UPDATE_REQUESTED',
      appSessionId,
      requestId: appSessionId,
      autonomy: 'high',
    });
  }
  state = reducer(state, {
    type: 'SETTINGS_UPDATES_UNANSWERED',
    liveAppSessionIds: new Set(['lost', 'resent']),
    resentRequestIds: new Set(['resent']),
  });
  assert.deepEqual(state.pendingAutonomy, { resent: { requestId: 'resent', autonomy: 'high' } });
});
