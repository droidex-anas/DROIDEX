import test from 'node:test';
import assert from 'node:assert/strict';
import { composeOrigin } from '../features/tabs/tabNavigation';
import { initialState, reducer, type AppState } from './useStore';
import type { TranscriptEvent } from '../types/bridge';
import { sessionSummary } from '../test/sessionSummary';
import { textEvent } from '../test/textEvent';

const session = (appSessionId: string, updatedAt: number) =>
  sessionSummary(appSessionId, {
    autonomy: 'off',
    phase: 'completed',
    createdAt: 1_000,
    updatedAt,
  });

const assistantText = (id: string, ts: number) =>
  textEvent(id, { appSessionId: 'sess-a', author: 'assistant', ts });

test('mark all sessions read advances every current session and ignores stale order ids', () => {
  const state: AppState = {
    ...initialState,
    sessions: {
      'sess-a': session('sess-a', 3_000),
      'sess-b': session('sess-b', 7_000),
    },
    sessionOrder: ['removed-session', 'sess-a', 'sess-b'],
    sessionLastSeen: { 'sess-a': 1_000, 'closed-session': 2_000 },
  };

  const next = reducer(state, { type: 'MARK_ALL_SESSIONS_READ', seenAt: 5_000 });

  assert.deepEqual(next.sessionLastSeen, {
    'sess-a': 5_000,
    'sess-b': 7_000,
    'closed-session': 2_000,
  });
  assert.equal(next.sessions, state.sessions);
  assert.equal(next.sessionOrder, state.sessionOrder);
});

test('batched transcript actions index the retained window once', () => {
  let retainedIdReads = 0;
  const retained: TranscriptEvent[] = Array.from({ length: 2_000 }, (_, index) => {
    const event = assistantText(`retained-${index}`, index);
    Object.defineProperty(event, 'id', {
      configurable: true,
      enumerable: true,
      get: () => {
        retainedIdReads += 1;
        return `retained-${index}`;
      },
    });
    return event;
  });
  const state: AppState = {
    ...initialState,
    transcripts: { 'sess-a': retained },
    transcriptRetainedCost: { 'sess-a': 1 },
  };
  const actions = Array.from({ length: 200 }, (_, index) => ({
    type: 'SESSION_TRANSCRIPT' as const,
    event: assistantText(`incoming-${index}`, retained.length + index),
  }));

  reducer(state, { type: 'BATCH', actions });

  assert.equal(retainedIdReads, retained.length);
});

test('non-transcript actions remain ordering barriers inside a batch', () => {
  const state: AppState = {
    ...initialState,
    sessions: { 'sess-a': session('sess-a', 3_000) },
    sessionOrder: ['sess-a'],
    listConfirmedSessionIds: ['sess-a'],
  };
  const beforeClose = assistantText('before-close', 1);
  const afterClose = assistantText('after-close', 1);
  const actions = [
    { type: 'SESSION_TRANSCRIPT' as const, event: beforeClose },
    { type: 'SESSION_LIST' as const, sessions: [] },
    { type: 'SESSION_TRANSCRIPT' as const, event: afterClose },
  ];

  const sequential = actions.reduce(reducer, state);
  const batched = reducer(state, { type: 'BATCH', actions });

  assert.deepEqual(
    { ...batched, transcriptMutations: {} },
    { ...sequential, transcriptMutations: {} },
  );
  assert.deepEqual(batched.transcripts['sess-a'], [afterClose]);
  assert.deepEqual(batched.transcriptMutations['sess-a'], {
    revision: 1,
    baseRevision: 0,
    kind: 'reset',
    previousLength: 0,
    firstChangedIndex: 0,
  });
});

test('nested batches remain ordering barriers between transcript runs', () => {
  const state: AppState = {
    ...initialState,
    sessions: { 'sess-a': session('sess-a', 3_000) },
    sessionOrder: ['sess-a'],
    listConfirmedSessionIds: ['sess-a'],
  };
  const beforePrune = assistantText('before-prune', 1);
  const insideNestedBatch = assistantText('inside-nested-batch', 2);
  const afterNestedBatch = assistantText('after-nested-batch', 3);
  const flattened = [
    { type: 'SESSION_TRANSCRIPT' as const, event: beforePrune },
    { type: 'SESSION_LIST' as const, sessions: [] },
    { type: 'SESSION_TRANSCRIPT' as const, event: insideNestedBatch },
    { type: 'SESSION_TRANSCRIPT' as const, event: afterNestedBatch },
  ];

  const sequential = flattened.reduce(reducer, state);
  const nested = reducer(state, {
    type: 'BATCH',
    actions: [flattened[0], { type: 'BATCH', actions: flattened.slice(1, 3) }, flattened[3]],
  });

  assert.deepEqual(
    { ...nested, transcriptMutations: {} },
    { ...sequential, transcriptMutations: {} },
  );
  assert.deepEqual(nested.transcripts['sess-a'], [insideNestedBatch, afterNestedBatch]);
  assert.deepEqual(nested.transcriptMutations['sess-a'], {
    revision: 2,
    baseRevision: 0,
    kind: 'reset',
    previousLength: 0,
    firstChangedIndex: 0,
  });
});

test('batched transcript provenance spans ordering barriers from the published revision', () => {
  const retained = assistantText('retained', 1);
  const state: AppState = {
    ...initialState,
    sessions: { 'sess-a': session('sess-a', 3_000) },
    sessionOrder: ['sess-a'],
    transcripts: { 'sess-a': [retained] },
    transcriptMutations: {
      'sess-a': {
        revision: 7,
        baseRevision: 6,
        kind: 'append',
        previousLength: 0,
        firstChangedIndex: 0,
      },
    },
  };
  const first = assistantText('first', 2);
  const second = assistantText('second', 3);

  const next = reducer(state, {
    type: 'BATCH',
    actions: [
      { type: 'SESSION_TRANSCRIPT', event: first },
      { type: 'MARK_ALL_SESSIONS_READ', seenAt: 4_000 },
      { type: 'SESSION_TRANSCRIPT', event: second },
    ],
  });

  assert.deepEqual(next.transcriptMutations['sess-a'], {
    revision: 9,
    baseRevision: 7,
    kind: 'append',
    previousLength: 1,
    firstChangedIndex: 1,
  });
});

test('session creation records the exact request-to-session settlement', () => {
  const state: AppState = {
    ...initialState,
    pendingCompose: {
      'client-1': {
        text: 'hello',
        skills: [],
        files: [],
        origin: composeOrigin(initialState.tabStrip),
      },
    },
  };

  const created = reducer(state, {
    type: 'SESSION_CREATED',
    clientRef: 'client-1',
    session: { ...session('created-session', 3_000), goal: 'hello' },
  });

  assert.deepEqual(created.lastCreatedSessionRequest, {
    clientRef: 'client-1',
    appSessionId: 'created-session',
  });
  assert.equal(created.pendingCompose['client-1'], undefined);
  assert.equal(created.transcripts['created-session'][0].text, 'hello');
  assert.deepEqual(created.transcriptMutations['created-session'], {
    revision: 1,
    baseRevision: 0,
    kind: 'append',
    previousLength: 0,
    firstChangedIndex: 0,
  });
});

test('session seeds preserve live file provenance without claiming background content', () => {
  const live = reducer(
    {
      ...initialState,
      pendingCompose: {
        'client-1': {
          text: 'typed prompt',
          skills: [],
          files: [],
          origin: composeOrigin(initialState.tabStrip),
        },
      },
    },
    {
      type: 'SESSION_CREATED',
      clientRef: 'client-1',
      session: { ...session('live-session', 3_000), goal: 'persisted prompt' },
    },
  );
  assert.deepEqual(live.transcripts['live-session']?.[0]?.files, []);

  const background = reducer(initialState, {
    type: 'SESSION_CREATED',
    clientRef: 'another-window',
    session: { ...session('background-session', 3_000), goal: 'persisted prompt' },
  });
  assert.equal(background.transcripts['background-session']?.[0]?.files, undefined);
});

test('a model change stays shown until its latest request settles', () => {
  const chat = session('sess-a', 1_000);
  let state: AppState = { ...initialState, sessions: { 'sess-a': chat } };
  for (const [requestId, modelId] of [
    ['r1', 'model-a'],
    ['r2', 'model-b'],
  ])
    state = reducer(state, {
      type: 'MODEL_UPDATE_REQUESTED',
      appSessionId: 'sess-a',
      requestId,
      settings: { modelId },
    });

  // The first request confirms while the second is still in flight.
  state = reducer(state, { type: 'SESSION_UPDATED', session: { ...chat, modelId: 'model-a' } });
  state = reducer(state, { type: 'MODEL_UPDATE_SETTLED', appSessionId: 'sess-a', requestId: 'r1' });
  assert.equal(state.pendingModelUpdates['sess-a']?.settings.modelId, 'model-b');

  state = reducer(state, { type: 'MODEL_UPDATE_SETTLED', appSessionId: 'sess-a', requestId: 'r2' });
  assert.equal(state.pendingModelUpdates['sess-a'], undefined);
});

test('a lost bridge drops model changes it can no longer settle', () => {
  let state = reducer(initialState, {
    type: 'MODEL_UPDATE_REQUESTED',
    appSessionId: 'sess-a',
    requestId: 'r1',
    settings: { reasoningEffort: 'high' },
  });
  state = reducer(state, { type: 'SET_CONNECTION', status: 'error', message: 'Bridge closed' });
  assert.deepEqual(state.pendingModelUpdates, {});

  // A replaced sidecar reconnects through a snapshot rather than a disconnect:
  // only the pending changes go, the chat the user is looking at stays.
  state = reducer(
    { ...initialState, selectedChild: { parentAppSessionId: 'sess-a', childSessionId: 'c1' } },
    {
      type: 'MODEL_UPDATE_REQUESTED',
      appSessionId: 'sess-a',
      requestId: 'r2',
      settings: { fastMode: true },
    },
  );
  for (const [appSessionId, requestId] of [
    ['sess-b', 'r3'],
    ['sess-c', 'r4'],
  ] as const)
    state = reducer(state, {
      type: 'MODEL_UPDATE_REQUESTED',
      appSessionId,
      requestId,
      settings: { fastMode: true },
    });
  // sess-c's request went to the new sidecar on reconnect; sess-b is closed and
  // gets no summary from the snapshot, so both keep their pending change.
  state = reducer(state, {
    type: 'SETTINGS_UPDATES_UNANSWERED',
    liveAppSessionIds: new Set(['sess-a', 'sess-c']),
    resentRequestIds: new Set(['r4']),
  });
  assert.deepEqual(Object.keys(state.pendingModelUpdates).sort(), ['sess-b', 'sess-c']);
  assert.equal(state.selectedChild?.childSessionId, 'c1');
});
