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

  const pending = reducer(drafted, {
    type: 'SET_PENDING_COMPOSE',
    clientRef: 'c-1',
    text: 'start chat',
    skills: [],
    files: [],
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

test('a pending autonomy change settles only on a confirmed level change', () => {
  const requested = reducer(
    { ...initialState, sessions: { 'app-1': session } },
    {
      type: 'AUTONOMY_UPDATE_REQUESTED',
      appSessionId: 'app-1',
      autonomy: 'high',
    },
  );
  assert.equal(requested.pendingAutonomy['app-1'], 'high');

  // An echo of the old confirmed level keeps the change pending.
  const echo = reducer(requested, { type: 'SESSION_UPDATED', session });
  assert.equal(echo.pendingAutonomy['app-1'], 'high');

  // The provider confirming the requested level settles it.
  const confirmed = reducer(requested, {
    type: 'SESSION_UPDATED',
    session: { ...session, autonomy: 'high' },
  });
  assert.equal(confirmed.pendingAutonomy['app-1'], undefined);

  // A change through another path (e.g. the CLI) also settles: the pending
  // request is no longer the latest truth.
  const externallyChanged = reducer(requested, {
    type: 'SESSION_UPDATED',
    session: { ...session, autonomy: 'off' },
  });
  assert.equal(externallyChanged.pendingAutonomy['app-1'], undefined);
});

test('closing a session drops its pending autonomy entry', () => {
  const requested = reducer(initialState, {
    type: 'AUTONOMY_UPDATE_REQUESTED',
    appSessionId: 'app-1',
    autonomy: 'high',
  });
  const closed = reducer(requested, { type: 'SESSION_CLOSED', appSessionId: 'app-1' });
  assert.equal(closed.pendingAutonomy['app-1'], undefined);
});

test('a failed autonomy update settles pending and toasts without failing the session', () => {
  const failure = {
    type: 'error' as const,
    code: 'session.autonomy_update_failed',
    appSessionId: 'app-1',
    message: 'Could not change autonomy: provider rejected the update',
    recoverable: true as const,
  };

  assert.equal(toastMessageForEvent(failure), failure.message);
  const action = adaptEvent(failure);
  assert.deepEqual(action, { type: 'AUTONOMY_UPDATE_SETTLED', appSessionId: 'app-1' });

  const state = {
    ...initialState,
    sessions: { 'app-1': session },
    pendingAutonomy: { 'app-1': 'high' as const },
  };
  const next = reducer(state, action!);
  assert.equal(next.pendingAutonomy['app-1'], undefined);
  assert.equal(next.sessions['app-1']?.phase, 'running');
  assert.equal(next.sessions['app-1']?.autonomy, 'medium');
});

test('an autonomy failure without a session id produces no reducer action', () => {
  const action = adaptEvent({
    type: 'error',
    code: 'session.autonomy_update_failed',
    message: 'no session',
    recoverable: true,
  });
  assert.equal(action, null);
});
