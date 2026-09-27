import assert from 'node:assert/strict';
import test from 'node:test';
import { initialState, reducer, type AppState } from './useStore';
import type { SessionSummary } from '../types/bridge';

function sessionSummary(
  appSessionId: string,
  overrides: Partial<SessionSummary> = {},
): SessionSummary {
  return {
    appSessionId,
    providerSessionId: appSessionId,
    provider: 'droid',
    sessionPurpose: 'chat',
    interactionMode: 'auto',
    role: 'primary',
    title: appSessionId,
    goal: appSessionId,
    cwd: '/workspace',
    autonomy: 'low',
    phase: 'paused',
    features: [],
    tokensIn: 0,
    tokensOut: 0,
    contextTokens: 0,
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  };
}

function withSource(): AppState {
  return {
    ...initialState,
    sessions: { source: sessionSummary('source') },
    sessionOrder: ['source'],
    activeAppSessionId: 'source',
    utilityPanels: {},
  };
}

function startSideChat(state: AppState, clientRef: string, prompt: string): AppState {
  const requested = reducer(state, {
    type: 'FORK_REQUESTED',
    clientRef,
    fork: { kind: 'side', sourceAppSessionId: 'source', prompt },
  });
  return reducer(requested, {
    type: 'SHOW_SIDE_CHAT',
    sourceAppSessionId: 'source',
    view: { kind: 'starting', clientRef, prompt },
  });
}

const sideLineage = { kind: 'side' as const, sourceAppSessionId: 'source', forkedAt: 500 };

test('a side chat opens beside its source without taking over the chat', () => {
  let state = startSideChat(withSource(), 'ref-1', 'Why this order?');
  const panel = state.utilityPanels['source'];
  assert.equal(panel?.tabs.find((tab) => tab.id === panel.activeTabId)?.tool, 'side');

  state = reducer(state, {
    type: 'SESSION_FORKED',
    clientRef: 'ref-1',
    session: sessionSummary('side-1', { lineage: sideLineage }),
  });

  assert.equal(state.activeAppSessionId, 'source');
  assert.deepEqual(state.pendingForks, {});
  assert.deepEqual(state.sideChats['source']?.view, { kind: 'chat', appSessionId: 'side-1' });
  // The question shows at the branch point, where the side chat's view begins.
  const [seed] = state.transcripts['side-1'] ?? [];
  assert.equal(seed?.text, 'Why this order?');
  assert.equal(seed?.ts, 500);
});

test('a side chat branched across harnesses also stays beside its source', () => {
  let state = startSideChat(withSource(), 'ref-2', 'Ask Codex');
  state = reducer(state, {
    type: 'SESSION_CREATED',
    clientRef: 'ref-2',
    session: sessionSummary('side-2', { provider: 'codex', lineage: sideLineage }),
  });

  assert.equal(state.activeAppSessionId, 'source');
  assert.deepEqual(state.sideChats['source']?.view, { kind: 'chat', appSessionId: 'side-2' });
});

test('a failed start hands the question back to the side-chat composer', () => {
  let state = startSideChat(withSource(), 'ref-3', 'Keep this question');
  state = reducer(state, { type: 'SESSION_CREATE_FAILED', clientRef: 'ref-3', message: 'nope' });

  assert.deepEqual(state.pendingForks, {});
  assert.deepEqual(state.sideChats['source']?.view, { kind: 'new', prompt: 'Keep this question' });
});

test('a start that lands after the user moved on leaves their view alone', () => {
  let state = startSideChat(withSource(), 'ref-4', 'Slow one');
  state = reducer(state, {
    type: 'SHOW_SIDE_CHAT',
    sourceAppSessionId: 'source',
    view: { kind: 'list' },
  });
  state = reducer(state, {
    type: 'SESSION_FORKED',
    clientRef: 'ref-4',
    session: sessionSummary('side-4', { lineage: sideLineage }),
  });

  assert.deepEqual(state.sideChats['source']?.view, { kind: 'list' });
  assert.ok(state.sessions['side-4']);
});

test('side chats are shown in one place: floating takes them out of the utility pane', () => {
  let state = reducer(withSource(), {
    type: 'SHOW_SIDE_CHAT',
    sourceAppSessionId: 'source',
    view: { kind: 'list' },
  });
  assert.ok(state.utilityPanels['source']?.tabs.some((tab) => tab.tool === 'side'));

  state = reducer(state, {
    type: 'PLACE_SIDE_CHATS',
    sourceAppSessionId: 'source',
    placement: 'floating',
  });
  assert.equal(
    state.utilityPanels['source']?.tabs.some((tab) => tab.tool === 'side'),
    false,
  );

  // Showing a view of minimized side chats brings the window back.
  state = reducer(state, {
    type: 'PLACE_SIDE_CHATS',
    sourceAppSessionId: 'source',
    placement: 'minimized',
  });
  state = reducer(state, {
    type: 'SHOW_SIDE_CHAT',
    sourceAppSessionId: 'source',
    view: { kind: 'list' },
  });
  assert.equal(state.sideChats['source']?.placement, 'floating');

  state = reducer(state, {
    type: 'PLACE_SIDE_CHATS',
    sourceAppSessionId: 'source',
    placement: 'docked',
  });
  assert.ok(state.utilityPanels['source']?.tabs.some((tab) => tab.tool === 'side'));
});
