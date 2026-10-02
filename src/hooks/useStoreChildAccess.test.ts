import assert from 'node:assert/strict';
import test from 'node:test';

import { adaptEvent, initialState, reducer, type AppState } from './useStore';
import {
  childSessionIsLive,
  shouldOpenSelectedChild,
  visibleSessionTarget,
} from '../lib/childSessions';
import { childStreamPhase } from '../lib/childSessionStream';
import type { ChildSessionSummary, ServerEvent } from '../types/bridge';
import { sessionSummary } from '../test/sessionSummary';

const child = (parentAppSessionId: string, childSessionId: string): ChildSessionSummary => ({
  parentAppSessionId,
  childSessionId,
  role: 'worker',
  status: 'paused',
  modelId: 'model-default',
  transcriptAvailable: true,
  streamFidelity: 'state',
});

const session = (appSessionId: string) =>
  sessionSummary(appSessionId, {
    providerSessionId: `provider-${appSessionId}`,
    goal: appSessionId,
    cwd: '/workspace',
  });

function select(
  state: AppState,
  parentAppSessionId: string,
  childSessionId: string,
  requestId: string,
): AppState {
  const withParent = {
    ...state,
    activeAppSessionId: parentAppSessionId,
    childSessions: {
      ...state.childSessions,
      [parentAppSessionId]: {
        ...(state.childSessions[parentAppSessionId] ?? {}),
        [childSessionId]: child(parentAppSessionId, childSessionId),
      },
    },
  };
  return reducer(withParent, {
    type: 'SELECT_CHILD',
    selection: { parentAppSessionId, childSessionId },
    requestId,
  });
}

/** Acknowledges a child open as ready on the given runtime generation. */
function ready(
  state: AppState,
  requestId: string,
  runtimeGeneration: number,
  childSessionId = 'child-a',
): AppState {
  return reducer(state, {
    type: 'CHILD_UPDATED',
    parentAppSessionId: 'parent-a',
    childSessionId,
    requestId,
    access: 'ready',
    runtimeGeneration,
  });
}

/** Reports parent-a/child-a's live runtime availability on a generation. */
function runtime(
  state: AppState,
  runtimeAvailable: boolean,
  runtimeGeneration: number,
  summary: ChildSessionSummary = child('parent-a', 'child-a'),
): AppState {
  return reducer(state, {
    type: 'SESSION_CHILD',
    child: summary,
    runtimeAvailable,
    runtimeGeneration,
  });
}

const accessOf = (state: AppState, childSessionId = 'child-a') =>
  state.childAccess['parent-a']?.[childSessionId];

const CLOSED = { state: 'closed', requestId: null } as const;

function dispatchEvent(state: AppState, event: ServerEvent): AppState {
  const action = adaptEvent(event);
  assert.ok(action);
  return reducer(state, action);
}

test('ready and history acknowledgements preserve their discriminated access state', () => {
  const readyState = ready(
    select(initialState, 'parent-a', 'child-a', 'request-ready'),
    'request-ready',
    3,
  );
  assert.deepEqual(accessOf(readyState), {
    state: 'ready',
    requestId: 'request-ready',
    runtimeGeneration: 3,
  });

  const history = reducer(select(initialState, 'parent-a', 'child-a', 'request-history'), {
    type: 'CHILD_UPDATED',
    parentAppSessionId: 'parent-a',
    childSessionId: 'child-a',
    requestId: 'request-history',
    access: 'history',
  });
  assert.deepEqual(accessOf(history), { state: 'history', requestId: 'request-history' });
});

test('a stale open result cannot resurrect readiness after selection changes', () => {
  let state = select(initialState, 'parent-a', 'child-a', 'request-a');
  state = select(state, 'parent-a', 'child-b', 'request-b');
  const afterStale = ready(state, 'request-a', 1);

  assert.equal(afterStale, state);
  assert.deepEqual(afterStale.selectedChild, {
    parentAppSessionId: 'parent-a',
    childSessionId: 'child-b',
  });
  assert.deepEqual(accessOf(afterStale, 'child-b'), { state: 'opening', requestId: 'request-b' });
});

test('same child IDs under different parents cannot cross-settle', () => {
  const state = select(initialState, 'parent-a', 'shared-child', 'request-a');
  const afterWrongParent = reducer(state, {
    type: 'CHILD_UPDATED',
    parentAppSessionId: 'parent-b',
    childSessionId: 'shared-child',
    requestId: 'request-a',
    access: 'history',
  });
  assert.equal(afterWrongParent, state);
});

test('live runtime summaries advance generation and stale generations cannot roll it back', () => {
  let state = ready(select(initialState, 'parent-a', 'child-a', 'request-a'), 'request-a', 3);
  state = runtime(state, true, 4);
  assert.deepEqual(accessOf(state), {
    state: 'ready',
    requestId: 'request-a',
    runtimeGeneration: 4,
  });

  const stale = runtime(state, true, 2);
  assert.deepEqual(stale.childAccess, state.childAccess);
});

test('a late ready acknowledgement cannot resurrect a runtime closed while opening', () => {
  let state = select(initialState, 'parent-a', 'child-a', 'request-a');
  state = runtime(state, true, 2);
  state = runtime(state, false, 3);
  const afterLateReady = ready(state, 'request-a', 2);

  assert.deepEqual(afterLateReady.childRuntime['parent-a']?.['child-a'], {
    available: false,
    runtimeGeneration: 3,
  });
  assert.deepEqual(accessOf(afterLateReady), CLOSED);
});

test('leaving an opening child invalidates its request before reselection', () => {
  let state = select(initialState, 'parent-a', 'child-a', 'request-a');
  state = reducer(state, { type: 'SELECT_CHILD', selection: null });
  assert.deepEqual(accessOf(state), CLOSED);

  state = reducer(state, {
    type: 'SELECT_CHILD',
    selection: { parentAppSessionId: 'parent-a', childSessionId: 'child-a' },
  });
  assert.equal(state.childAccess['parent-a'], undefined);

  state = select(state, 'parent-a', 'child-a', 'request-b');
  const afterLateReady = ready(state, 'request-a', 2);
  assert.deepEqual(accessOf(afterLateReady), { state: 'opening', requestId: 'request-b' });
});

test('disconnect clears child selection, access, and runtime watermarks', () => {
  let state = select(initialState, 'parent-a', 'child-a', 'request-a');
  const stats = (used: number) => ({
    used,
    remaining: 100 - used,
    limit: 100,
    accuracy: 'exact' as const,
    updatedAt: '2026-07-30T00:00:00.000Z',
  });
  state = {
    ...state,
    contextStats: {
      primary: { 'parent-a': stats(10) },
      child: { 'parent-a': { 'child-a': stats(20) } },
    },
  };
  state = ready(state, 'request-a', 2);
  state = reducer(state, { type: 'SET_CONNECTION', status: 'error', message: 'closed' });

  assert.equal(state.selectedChild, null);
  assert.deepEqual(state.childAccess, {});
  assert.deepEqual(state.childRuntime, {});
  assert.deepEqual(state.contextStats.primary['parent-a']?.used, 10);
  assert.deepEqual(state.contextStats.child, {});
});

test('switching parents, starting a draft, or creating a parent invalidates an opening child', () => {
  const navigations: Array<[string, (state: AppState) => AppState]> = [
    [
      'activate another parent',
      (state) => reducer(state, { type: 'SET_ACTIVE_SESSION', id: 'parent-b' }),
    ],
    [
      'reactivate the parent',
      (state) => reducer(state, { type: 'SET_ACTIVE_SESSION', id: 'parent-a' }),
    ],
    [
      'start a draft',
      (state) =>
        reducer(state, { type: 'START_CHAT', cwd: '/workspace', executionMode: 'worktree' }),
    ],
    [
      'create a parent',
      (state) =>
        reducer(
          reducer(state, {
            type: 'SET_PENDING_COMPOSE',
            clientRef: 'new-parent',
            text: 'start parent',
            skills: [],
            files: [],
          }),
          { type: 'SESSION_CREATED', clientRef: 'new-parent', session: session('parent-b') },
        ),
    ],
  ];
  for (const [label, navigate] of navigations) {
    const state = navigate(select(initialState, 'parent-a', 'child-a', 'request-a'));
    assert.equal(state.selectedChild, null, label);
    assert.deepEqual(accessOf(state), CLOSED, label);
  }
});

test('resuming a background parent does not steal the selected session', () => {
  let state = select(initialState, 'parent-a', 'child-a', 'request-a');
  state = reducer(state, {
    type: 'SESSION_CREATED',
    clientRef: 'resume:parent-b',
    session: session('parent-b'),
  });

  assert.equal(state.activeAppSessionId, 'parent-a');
  assert.deepEqual(state.selectedChild, {
    parentAppSessionId: 'parent-a',
    childSessionId: 'child-a',
  });
  assert.deepEqual(accessOf(state), { state: 'opening', requestId: 'request-a' });
});

test('resuming a historical parent clears its terminal child access state', () => {
  let state = select(initialState, 'parent-a', 'child-a', 'request-a');
  state = reducer(state, {
    type: 'CHILD_UPDATED',
    parentAppSessionId: 'parent-a',
    childSessionId: 'child-a',
    requestId: 'request-a',
    access: 'history',
  });
  state = reducer(state, {
    type: 'SESSION_CREATED',
    clientRef: 'resume-parent',
    session: session('parent-a'),
  });

  assert.equal(state.selectedChild, null);
  assert.equal(state.childAccess['parent-a'], undefined);
  assert.equal(state.childRuntime['parent-a'], undefined);
});

test('a stale runtime generation cannot roll back the child summary or close a newer runtime', () => {
  const state = ready(select(initialState, 'parent-a', 'child-a', 'request-a'), 'request-a', 4);
  const stale = runtime(state, false, 3, {
    ...child('parent-a', 'child-a'),
    status: 'completed',
    modelId: 'stale-model',
  });

  assert.equal(stale, state);
  assert.equal(stale.childSessions['parent-a']?.['child-a']?.modelId, 'model-default');

  const sameRuntimeUpdate = runtime(state, true, 4, {
    ...child('parent-a', 'child-a'),
    modelId: 'accepted-model',
  });
  assert.equal(sameRuntimeUpdate.childSessions['parent-a']?.['child-a']?.modelId, 'accepted-model');
});

test('failed child access retries only after explicit reselection', () => {
  let state = select(initialState, 'parent-a', 'child-a', 'request-a');
  state = reducer(state, {
    type: 'CHILD_ERROR',
    parentAppSessionId: 'parent-a',
    childSessionId: 'child-a',
    operation: 'open',
    requestId: 'request-a',
    code: 'child.open_failed',
    message: 'failed',
  });
  assert.deepEqual(accessOf(state), { state: 'failed', requestId: 'request-a' });

  state = reducer(state, {
    type: 'SELECT_CHILD',
    selection: { parentAppSessionId: 'parent-a', childSessionId: 'child-a' },
  });
  assert.equal(state.childAccess['parent-a'], undefined);

  state = select(state, 'parent-a', 'child-a', 'request-b');
  const afterLateReady = ready(state, 'request-a', 2);
  assert.deepEqual(accessOf(afterLateReady), { state: 'opening', requestId: 'request-b' });
});

test('child history errors settle the loading state for retry', () => {
  let state = reducer(initialState, {
    type: 'CHILD_HISTORY_LOADING',
    parentAppSessionId: 'parent-a',
    childSessionId: 'child-a',
  });

  state = reducer(state, {
    type: 'CHILD_ERROR',
    parentAppSessionId: 'parent-a',
    childSessionId: 'child-a',
    operation: 'loadHistory',
    requestId: null,
    message: 'history unavailable',
  });

  assert.deepEqual(state.childHistory['parent-a']?.['child-a'], {
    status: 'failed',
    loadedCount: 0,
    hasMore: false,
    error: 'history unavailable',
    isLoaded: false,
    isLoadingOlder: false,
    olderCursor: undefined,
    isViewportPinned: true,
  });
});

test('canonical child summaries update only the exact parent-owned child', () => {
  const action = adaptEvent({
    type: 'session.child',
    event: 'upserted',
    child: {
      ...child('parent-a', 'child-a'),
      modelId: 'model-new',
      reasoningEffort: 'high',
    },
    runtimeAvailable: false,
    runtimeGeneration: 1,
  });
  assert.ok(action);
  const state = reducer(initialState, action);

  assert.equal(state.childSessions['parent-a']?.['child-a']?.modelId, 'model-new');
  assert.equal(state.childSessions['parent-a']?.['child-a']?.reasoningEffort, 'high');
  assert.equal('providerSessionId' in state.childSessions['parent-a']!['child-a']!, false);
});

test('a selected queued open stays pending and becomes usable when the runtime is admitted', () => {
  let state = select(initialState, 'parent-a', 'child-a', 'request-a');
  state = dispatchEvent(state, {
    type: 'session.child',
    event: 'upserted',
    child: { ...child('parent-a', 'child-a'), queued: true },
    runtimeAvailable: false,
    runtimeGeneration: 1,
  });

  assert.deepEqual(state.childAccess['parent-a']?.['child-a'], {
    state: 'opening',
    requestId: 'request-a',
  });
  assert.equal(state.childSessions['parent-a']?.['child-a']?.queued, true);
  assert.deepEqual(state.childRuntime['parent-a']?.['child-a'], {
    available: false,
    runtimeGeneration: 1,
  });
  assert.equal(
    childStreamPhase({
      queued: state.childSessions['parent-a']?.['child-a']?.queued,
      status: state.childSessions['parent-a']?.['child-a']?.status,
    }),
    'queued',
  );
  assert.equal(
    childSessionIsLive(
      state.childSessions['parent-a']!['child-a']!,
      state.childRuntime['parent-a']?.['child-a'],
    ),
    false,
  );
  assert.equal(shouldOpenSelectedChild(state.childAccess['parent-a']?.['child-a']), false);
  const queuedTarget = visibleSessionTarget(
    'parent-a',
    { parentAppSessionId: 'parent-a', childSessionId: 'child-a' },
    state.childSessions,
    state.childAccess,
  );
  assert.equal(queuedTarget.kind, 'child');
  if (queuedTarget.kind === 'child') {
    assert.equal(queuedTarget.canSend, false);
    assert.equal(queuedTarget.canInterrupt, false);
    assert.equal(queuedTarget.settingsReadiness, 'opening');
  }

  state = dispatchEvent(state, {
    type: 'session.child',
    event: 'upserted',
    child: child('parent-a', 'child-a'),
    runtimeAvailable: false,
    runtimeGeneration: 1,
  });
  assert.deepEqual(state.childAccess['parent-a']?.['child-a'], {
    state: 'opening',
    requestId: 'request-a',
  });

  state = dispatchEvent(state, {
    type: 'session.child',
    event: 'upserted',
    child: child('parent-a', 'child-a'),
    runtimeAvailable: true,
    runtimeGeneration: 2,
  });
  state = dispatchEvent(state, {
    type: 'child.updated',
    parentAppSessionId: 'parent-a',
    childSessionId: 'child-a',
    requestId: 'request-a',
    access: 'ready',
    runtimeGeneration: 2,
  });

  assert.deepEqual(state.childAccess['parent-a']?.['child-a'], {
    state: 'ready',
    requestId: 'request-a',
    runtimeGeneration: 2,
  });
  assert.deepEqual(state.childRuntime['parent-a']?.['child-a'], {
    available: true,
    runtimeGeneration: 2,
  });
  const readyTarget = visibleSessionTarget(
    'parent-a',
    { parentAppSessionId: 'parent-a', childSessionId: 'child-a' },
    state.childSessions,
    state.childAccess,
  );
  assert.equal(readyTarget.kind, 'child');
  if (readyTarget.kind === 'child') {
    assert.equal(readyTarget.canSend, true);
    assert.equal(readyTarget.settingsReadiness, 'ready');
  }
});
