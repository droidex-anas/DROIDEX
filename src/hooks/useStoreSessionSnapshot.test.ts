import test from 'node:test';
import assert from 'node:assert/strict';
import { reducer, initialState } from './useStore';
import type { AppState } from './useStore';
import { persistStoreChanges } from './storePersistence';
import { saveTabStrip } from '../features/tabs/tabStorage';
import { saveSessionSnapshot } from '../lib/sessionSnapshot';
import { withLocalStorageMap, withLocalStorageMapAsync } from '../test/localStorage';
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

// The store reads storage once, when its module loads, so a restart is a fresh
// import over the storage the previous run wrote.
async function relaunchStore(storage: Map<string, string>): Promise<typeof import('./useStore')> {
  let store: typeof import('./useStore') | undefined;
  await withLocalStorageMapAsync(storage, async () => {
    const url = new URL(`./useStore.tsx?relaunch=${crypto.randomUUID()}`, import.meta.url);
    store = (await import(url.href)) as typeof import('./useStore');
  });
  assert.ok(store);
  return store;
}

test('a restart reopens the chat and tab that were open, including ones the first list omits', async () => {
  const outside = { ...summary('thread', 3), cwd: '/outside-the-workspaces' };
  let state = reducer(initialState, { type: 'REVEAL_EARLIER_SESSIONS', executionCwds: ['/repo'] });
  state = reducer(state, { type: 'SESSION_LIST', sessions: [summary('kept', 2)] });
  state = reducer(state, { type: 'SESSION_UPDATED', session: outside });
  state = reducer(state, { type: 'SESSION_LIST', sessions: [summary('kept', 2)] });
  state = reducer(state, { type: 'SET_ACTIVE_SESSION', id: 'thread' });
  const storage = new Map<string, string>();
  withLocalStorageMap(storage, () => {
    // Node reads as an embedded copy, which never saves tabs, so save them directly.
    persistStoreChanges(initialState, state);
    saveTabStrip(state);
    saveSessionSnapshot(state);
  });

  const relaunched = await relaunchStore(storage);
  // The first request reveals the same folders, so it covers what the last list confirmed.
  assert.deepEqual(relaunched.initialState.revealEarlierCwds, ['/repo']);
  const next = relaunched.reducer(relaunched.initialState, {
    type: 'SESSION_LIST',
    sessions: [summary('kept', 4)],
    earlierSessionsByCwd: {},
  });
  assert.equal(next.activeAppSessionId, 'thread');
  assert.deepEqual(
    next.tabStrip.tabs.map((tab) => tab.page),
    [{ kind: 'chat', appSessionId: 'thread' }],
  );
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
