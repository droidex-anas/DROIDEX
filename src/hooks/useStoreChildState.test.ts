import assert from 'node:assert/strict';
import test from 'node:test';

import type { ChildSessionSummary, SessionSummary } from '../types/bridge';
import { childSessionIsLive } from '../lib/childSessions';
import { initialState, reducer, type Action } from './useStore';

function session(appSessionId: string): SessionSummary {
  return {
    appSessionId,
    providerSessionId: `provider-${appSessionId}`,
    provider: 'droid',
    sessionPurpose: 'mission-control',
    interactionMode: 'agi',
    role: 'primary',
    title: appSessionId,
    goal: 'test',
    cwd: '/workspace',
    workspaceKind: 'folder',
    autonomy: 'low',
    phase: 'paused',
    features: [],
    tokensIn: 0,
    tokensOut: 0,
    contextTokens: 0,
    createdAt: 1,
    updatedAt: 1,
  };
}

function child(parentAppSessionId: string, childSessionId: string): ChildSessionSummary {
  return {
    parentAppSessionId,
    childSessionId,
    role: 'worker',
    status: 'paused',
    modelId: 'model-default',
    transcriptAvailable: true,
    streamFidelity: 'state',
  };
}

test('same-event sibling progress remains distinct by exact child identity', () => {
  const state = reducer(initialState, {
    type: 'SESSION_PROGRESS',
    appSessionId: 'parent',
    entries: [
      {
        id: 'progress-a',
        timestamp: '2026-07-30T00:00:00.000Z',
        type: 'worker_started',
        title: 'Workers started',
        featureId: 'feature',
        workerChildSessionId: 'child-a',
      },
      {
        id: 'progress-b',
        timestamp: '2026-07-30T00:00:00.000Z',
        type: 'worker_started',
        title: 'Workers started',
        featureId: 'feature',
        workerChildSessionId: 'child-b',
      },
    ],
  });

  assert.deepEqual(
    state.progress.parent?.map((entry) => entry.workerChildSessionId),
    ['child-a', 'child-b'],
  );
});

test('closing a parent preserves historical parent and child discovery but clears live targeting', () => {
  const parent = session('parent');
  const historicalChild = child('parent', 'child');
  historicalChild.status = 'running';
  const state = reducer(
    {
      ...initialState,
      sessions: { parent },
      sessionOrder: ['parent'],
      activeAppSessionId: 'parent',
      childSessions: { parent: { child: historicalChild } },
      childAccess: {
        parent: { child: { state: 'ready', requestId: 'open', runtimeGeneration: 1 } },
      },
      childRuntime: { parent: { child: { available: true, runtimeGeneration: 1 } } },
      contextStats: {
        primary: {},
        child: {
          parent: {
            child: {
              used: 20,
              remaining: 80,
              limit: 100,
              accuracy: 'exact',
              updatedAt: '2026-07-30T00:00:00.000Z',
            },
          },
          other: {
            child: {
              used: 30,
              remaining: 70,
              limit: 100,
              accuracy: 'exact',
              updatedAt: '2026-07-30T00:00:00.000Z',
            },
          },
        },
      },
      selectedChild: { parentAppSessionId: 'parent', childSessionId: 'child' },
      historyLoaded: true,
    },
    { type: 'SESSION_CLOSED', appSessionId: 'parent' },
  );

  assert.equal(state.sessions.parent, parent);
  assert.deepEqual(state.sessionOrder, ['parent']);
  assert.equal(state.activeAppSessionId, 'parent');
  assert.equal(state.childSessions.parent?.child, historicalChild);
  assert.equal(state.childAccess.parent, undefined);
  assert.equal(state.childRuntime.parent, undefined);
  assert.equal(state.contextStats.child.parent, undefined);
  assert.equal(state.contextStats.child.other?.child?.used, 30);
  assert.equal(state.selectedChild, null);
  assert.equal(
    childSessionIsLive(
      state.childSessions.parent.child,
      state.childRuntime.parent?.[historicalChild.childSessionId],
    ),
    false,
  );
});

test('a chat is marked as having agents working only while one is running', () => {
  const upsert = (child: ChildSessionSummary) =>
    ({ type: 'SESSION_CHILD', child, runtimeAvailable: false, runtimeGeneration: 1 }) as const;
  const running: ChildSessionSummary = { ...child('parent', 'child'), status: 'running' };

  const started = reducer(initialState, upsert(running));
  assert.deepEqual(started.agentsWorkingByParent, { parent: true });

  // An activity preview and a token tick arrive as full child upserts; neither
  // crosses the status, so the sidebar's map must stay the same object.
  const ticked = reducer(
    started,
    upsert({ ...running, activity: { preview: 'reading the sidecar' }, tokensUsed: 120 }),
  );
  assert.equal(ticked.agentsWorkingByParent, started.agentsWorkingByParent);
  assert.notEqual(ticked.childSessions.parent, started.childSessions.parent);

  const settled = reducer(ticked, upsert({ ...running, status: 'completed' }));
  assert.deepEqual(settled.agentsWorkingByParent, {});
});

test('child batches preserve published state and sequential lifecycle transitions across barriers', () => {
  const update = (
    parentId: string,
    childId: string,
    generation: number,
    available: boolean,
  ): Action => ({
    type: 'SESSION_CHILD',
    child: { ...child(parentId, childId), status: available ? 'running' : 'completed' },
    runtimeAvailable: available,
    runtimeGeneration: generation,
  });
  const state = reducer(initialState, {
    type: 'BATCH',
    actions: [
      update('parent', 'one', 1, true),
      update('other', 'two', 1, true),
      update('untouched', 'three', 1, true),
    ],
  });
  for (const record of [
    state.childSessions,
    state.childRuntime,
    state.childAccess,
    state.contextStats.child,
  ]) {
    for (const parent of Object.values(record)) Object.freeze(parent);
    Object.freeze(record);
  }
  Object.freeze(state.agentsWorkingByParent);
  Object.freeze(state.contextStats);
  Object.freeze(state);
  const actions: Action[] = [
    update('parent', 'one', 2, true),
    update('parent', 'one', 1, false), // Stale settlement must not win.
    update('parent', 'sibling', 1, true),
    update('other', 'two', 2, false),
    { type: 'BATCH', actions: [update('parent', 'one', 2, false)] },
    update('parent', 'sibling', 2, false),
    { type: 'SET_CONNECTION', status: 'disconnected' },
    update('parent', 'one', 3, true),
    update('parent', 'one', 3, false),
  ];
  const next = reducer(state, { type: 'BATCH', actions });
  const sequential = actions.reduce(reducer, state);
  assert.deepEqual(next, sequential);
  assert.equal(state.childRuntime.parent.one.runtimeGeneration, 1);
  assert.equal(state.childSessions.parent.one.status, 'running');
  assert.equal(next.childSessions.untouched, state.childSessions.untouched);
  assert.equal(next.childRuntime.parent.one.available, false);
  assert.equal(next.agentsWorkingByParent.parent, undefined);
  assert.equal(
    reducer(state, { type: 'BATCH', actions: [update('parent', 'one', 0, false)] }),
    state,
  );
});
