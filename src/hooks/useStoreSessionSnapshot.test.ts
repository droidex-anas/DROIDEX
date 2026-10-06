import test from 'node:test';
import assert from 'node:assert/strict';
import { reducer, initialState } from './useStore';
import type { AppState } from './useStore';
import { sessionSummary } from '../test/sessionSummary';

const summary = (id: string, updatedAt = 1) =>
  sessionSummary(id, {
    title: `Chat ${id}`,
    goal: `Chat ${id}`,
    cwd: '/repo',
    createdAt: updatedAt,
    updatedAt,
  });

function hydratedState(): AppState {
  return {
    ...(initialState as unknown as AppState),
    sessions: { stale: summary('stale', 1), kept: summary('kept', 2) },
    sessionOrder: ['kept', 'stale'],
    listConfirmedSessionIds: ['stale', 'kept'],
  };
}

test('the first SESSION_LIST prunes hydrated rows the sidecar does not confirm', () => {
  const next = reducer(hydratedState(), {
    type: 'SESSION_LIST',
    sessions: [summary('kept', 3), summary('fresh', 4)],
  });
  assert.deepEqual(Object.keys(next.sessions).sort(), ['fresh', 'kept']);
  assert.deepEqual(next.sessionOrder, ['fresh', 'kept']);
  assert.deepEqual(next.listConfirmedSessionIds, ['kept', 'fresh']);
});

test('rows no list has confirmed, such as local creations, survive a list that omits them', () => {
  const created = reducer(hydratedState(), {
    type: 'SESSION_CREATED',
    clientRef: 'ref-1',
    session: summary('optimistic', 5),
  });
  const next = reducer(created, { type: 'SESSION_LIST', sessions: [summary('kept', 3)] });
  assert.deepEqual(Object.keys(next.sessions).sort(), ['kept', 'optimistic']);
  assert.deepEqual(next.listConfirmedSessionIds, ['kept']);

  // Without a hydrated snapshot nothing is prunable yet.
  const unhydrated: AppState = {
    ...(initialState as unknown as AppState),
    sessions: { local: summary('local', 1) },
    sessionOrder: ['local'],
    listConfirmedSessionIds: null,
  };
  const listed = reducer(unhydrated, { type: 'SESSION_LIST', sessions: [summary('server', 2)] });
  assert.deepEqual(Object.keys(listed.sessions).sort(), ['local', 'server']);
});

test('a session updated before the first SESSION_LIST survives the prune and stays in order', () => {
  // The snapshot marker set is fixed at hydration; a live update for a
  // session outside it (e.g. a background session the bridge reports before
  // the first list) must not make it prunable. SESSION_UPDATED adds it to the
  // sessions map but not to sessionOrder, so the reconciled order must still
  // include it for it to render in the sidebar.
  const updated = reducer(hydratedState(), {
    type: 'SESSION_UPDATED',
    session: summary('live', 50),
  });
  const next = reducer(updated, { type: 'SESSION_LIST', sessions: [summary('kept', 3)] });
  assert.deepEqual(Object.keys(next.sessions).sort(), ['kept', 'live']);
  assert.deepEqual(next.sessionOrder, ['live', 'kept']);
});

test('the active session id is cleared when pruned and kept when confirmed', () => {
  for (const [active, expected] of [
    ['stale', null],
    ['kept', 'kept'],
  ] as const) {
    const state: AppState = { ...hydratedState(), activeAppSessionId: active };
    const next = reducer(state, { type: 'SESSION_LIST', sessions: [summary('kept', 3)] });
    assert.equal(next.activeAppSessionId, expected, active);
  }
});

test('a later SESSION_LIST drops rows the previous list confirmed but it omits', () => {
  // Regression test: a session deleted outside the app (CLI, parallel
  // instance) must disappear from the sidebar when the watcher republishes,
  // not linger until a reload.
  const confirmed = reducer(hydratedState(), {
    type: 'SESSION_LIST',
    sessions: [summary('kept', 3), summary('external', 4)],
  });
  const next = reducer(confirmed, { type: 'SESSION_LIST', sessions: [summary('kept', 5)] });
  assert.deepEqual(Object.keys(next.sessions), ['kept']);
  assert.equal(next.sessions.kept?.updatedAt, 5);
  assert.deepEqual(next.listConfirmedSessionIds, ['kept']);
});
