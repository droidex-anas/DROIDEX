import test from 'node:test';
import assert from 'node:assert/strict';

import { adaptEvent, initialState, reducer, toastMessageForEvent } from './useStore';
import type { ServerEvent } from '../types/bridge';
import { sessionSummary } from '../test/sessionSummary';

const session = sessionSummary('app-1', {
  providerSessionId: 'provider-1',
  title: 'Chat',
  workspaceKind: 'none',
  phase: 'running',
});

test('non-open child command failures are routed to user-visible toast feedback', () => {
  const failure = {
    type: 'child.error' as const,
    code: 'child.settings_update_failed',
    parentAppSessionId: 'app-1',
    childSessionId: 'child-1',
    requestId: null,
    operation: 'settings' as const,
    message: 'Could not update child settings: provider rejected',
  };

  assert.equal(toastMessageForEvent(failure), failure.message);
  assert.deepEqual(adaptEvent(failure), {
    type: 'CHILD_ERROR',
    parentAppSessionId: 'app-1',
    childSessionId: 'child-1',
    requestId: null,
    operation: 'settings',
    message: failure.message,
  });
  assert.equal(
    toastMessageForEvent({
      ...failure,
      code: 'child.settings_target_invalid',
    }),
    failure.message,
  );
  assert.equal(
    toastMessageForEvent({
      ...failure,
      code: 'child.send_failed',
      operation: 'send',
    }),
    failure.message,
  );
  assert.equal(
    toastMessageForEvent({
      ...failure,
      code: 'child.not_in_session',
      operation: 'loadHistory',
    }),
    failure.message,
  );
  assert.equal(
    toastMessageForEvent({
      ...failure,
      code: 'child.open_failed',
      operation: 'open',
    }),
    undefined,
  );
});

test('a primary error fails only the primary session', () => {
  const action = adaptEvent({
    type: 'error',
    appSessionId: 'app-1',
    providerSessionId: 'provider-1',
    message: 'resume failed',
  });
  assert.ok(action);

  const state = {
    ...initialState,
    sessions: { 'app-1': session },
  };
  const next = reducer(state, action);

  assert.equal(next.sessions['app-1']?.phase, 'failed');
});

test('a create failure clears only its matching pending first message', () => {
  const held = reducer(initialState, { type: 'HOLD_COMPOSE_ORIGIN', holdId: 'hold-1' });
  const withFirst = reducer(held, {
    type: 'SET_PENDING_COMPOSE',
    clientRef: 'client-1',
    text: 'first',
    skills: [],
    files: [],
    originHoldId: 'hold-1',
  });
  const withBoth = reducer(withFirst, {
    type: 'SET_PENDING_COMPOSE',
    clientRef: 'client-2',
    text: 'second',
    skills: [],
    files: [],
    originHoldId: 'hold-1',
  });
  const failure = {
    type: 'error' as const,
    code: 'session.create_failed',
    clientRef: 'client-1',
    message: 'Could not create session',
  };
  const action = adaptEvent(failure);
  assert.ok(action);
  assert.deepEqual(action, {
    type: 'SESSION_CREATE_FAILED',
    clientRef: 'client-1',
    message: failure.message,
  });

  const next = reducer(withBoth, action);
  assert.deepEqual(Object.keys(next.pendingCompose), ['client-2']);
  assert.equal(next.pendingCompose['client-2']?.text, 'second');
  assert.equal(next.sessions, withBoth.sessions);
  assert.equal(next.activeAppSessionId, withBoth.activeAppSessionId);
  assert.equal(toastMessageForEvent(failure), failure.message);
});

test('a matching child-open error settles access without failing the parent session', () => {
  const action = adaptEvent({
    type: 'child.error',
    code: 'child.open_failed',
    parentAppSessionId: 'app-1',
    childSessionId: 'child-1',
    requestId: 'request-1',
    operation: 'open',
    message: 'child failed to open',
  });
  assert.ok(action);

  const state = {
    ...initialState,
    sessions: { 'app-1': session },
    activeAppSessionId: 'app-1',
    selectedChild: { parentAppSessionId: 'app-1', childSessionId: 'child-1' },
    childAccess: { 'app-1': { 'child-1': { state: 'opening', requestId: 'request-1' } } },
  };
  const next = reducer(state, action);

  assert.equal(next.sessions['app-1']?.phase, 'running');
  assert.deepEqual(next.childAccess['app-1']?.['child-1'], {
    state: 'failed',
    requestId: 'request-1',
  });
});

test('server errors route to toasts and connection state by code and recoverability', () => {
  const resyncMessage = 'The renderer fell behind. Reopen the active session to refresh it.';
  // [event, toast it shows, reducer action it becomes; 'any' leaves the action unchecked]
  const cases: Array<[ServerEvent, string | undefined, ReturnType<typeof adaptEvent> | 'any']> = [
    // A recoverable parent error stays out of reducer state.
    [
      {
        type: 'error',
        appSessionId: 'app-1',
        providerSessionId: 'provider-1',
        message: 'history restore failed',
        recoverable: true,
      },
      undefined,
      null,
    ],
    // A resync toasts and becomes a connection error only when unrecoverable.
    [
      { type: 'error', code: 'bridge.resync_required', message: resyncMessage, recoverable: false },
      resyncMessage,
      { type: 'SET_CONNECTION', status: 'error', message: resyncMessage },
    ],
    [
      {
        type: 'error',
        code: 'bridge.resync_required',
        message: 'Reconnecting.',
        recoverable: true,
      },
      'Reconnecting.',
      null,
    ],
    // Version skew must reach the user instead of a silent hang.
    [
      { type: 'error', code: 'bridge.unsupported_command', message: 'Restart the app.' },
      'Restart the app.',
      'any',
    ],
    // Unflushed history and interrupted turns toast instead of looking durable.
    [
      { type: 'error', code: 'history.unflushed_work', message: 'Unflushed.', recoverable: true },
      'Unflushed.',
      null,
    ],
    [
      {
        type: 'error',
        code: 'session.interrupted',
        appSessionId: 'app-1',
        message: 'Interrupted.',
        recoverable: true,
      },
      'Interrupted.',
      null,
    ],
    // History persistence and search status belong to the history health store.
    [
      {
        type: 'error',
        code: 'history.persistence_degraded',
        message: 'Degraded.',
        recoverable: true,
      },
      undefined,
      null,
    ],
    [
      {
        type: 'error',
        code: 'history.search_unavailable',
        message: 'No search.',
        recoverable: false,
      },
      'No search.',
      null,
    ],
    [{ type: 'history.persistenceRecovered' }, undefined, null],
    [
      {
        type: 'error',
        code: 'history.unavailable',
        message: 'Repair history.',
        recoverable: false,
      },
      'Repair history.',
      null,
    ],
  ];
  for (const [event, toast, action] of cases) {
    const label = 'code' in event ? String(event.code) : event.type;
    assert.equal(toastMessageForEvent(event), toast, label);
    if (action !== 'any') assert.deepEqual(adaptEvent(event), action, label);
  }
});
