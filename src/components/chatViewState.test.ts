import test from 'node:test';
import assert from 'node:assert/strict';
import { initialState, type AppState } from '../hooks/useStore';
import type { SessionSummary } from '../types/bridge';
import { equalVisibleChatState, selectChatViewState } from './chatViewState';

function session(appSessionId: string, overrides: Partial<SessionSummary> = {}): SessionSummary {
  return {
    appSessionId,
    provider: 'droid',
    sessionPurpose: 'chat',
    interactionMode: 'auto',
    role: 'primary',
    title: appSessionId,
    goal: '',
    cwd: '/tmp/project',
    autonomy: 'off',
    phase: 'completed',
    features: [],
    tokensIn: 0,
    tokensOut: 0,
    contextTokens: 0,
    createdAt: 1_000,
    updatedAt: 1_000,
    ...overrides,
  };
}

function activeState(): AppState {
  return {
    ...initialState,
    activeAppSessionId: 'active',
    sessions: {
      active: session('active'),
      background: session('background'),
    },
    transcripts: {
      active: [],
      background: [],
    },
  };
}

function appendMutation() {
  return {
    revision: 1,
    baseRevision: 0,
    kind: 'append' as const,
    previousLength: 0,
    firstChangedIndex: 0,
  };
}

function visibleStateEqual(change: (previous: AppState) => AppState): boolean {
  const previous = activeState();
  return equalVisibleChatState(
    selectChatViewState(previous, 'active', null),
    selectChatViewState(change(previous), 'active', null),
  );
}

test('chat selector ignores background streams and telemetry-only summary updates', () => {
  const backgroundStream = visibleStateEqual((previous) => ({
    ...previous,
    transcripts: { ...previous.transcripts, background: [...previous.transcripts.background] },
    transcriptRetainedCost: { ...previous.transcriptRetainedCost, background: 10 },
    transcriptMutations: { background: appendMutation() },
  }));
  assert.equal(backgroundStream, true);

  const telemetry = visibleStateEqual((previous) => ({
    ...previous,
    sessions: {
      ...previous.sessions,
      active: session('active', { tokensOut: 10, updatedAt: 2_000 }),
    },
  }));
  assert.equal(telemetry, true);
});

test('chat selector follows the session its view shows, not the active one', () => {
  const previous = activeState();
  const next: AppState = {
    ...previous,
    transcripts: { ...previous.transcripts, background: [...previous.transcripts.background] },
  };

  const shown = selectChatViewState(next, 'background', null);
  assert.equal(shown.activeSession?.appSessionId, 'background');
  assert.equal(
    equalVisibleChatState(selectChatViewState(previous, 'background', null), shown),
    false,
  );
});

test('chat selector observes the visible transcript, its provenance, and visible session fields', () => {
  const changes: Record<string, (previous: AppState) => AppState> = {
    'transcript provenance': (previous) => ({
      ...previous,
      transcriptMutations: { active: appendMutation() },
    }),
    transcript: (previous) => ({
      ...previous,
      transcripts: { ...previous.transcripts, active: [...previous.transcripts.active] },
    }),
    title: (previous) => ({
      ...previous,
      sessions: { ...previous.sessions, active: session('active', { title: 'Renamed' }) },
    }),
    interruptReason: (previous) => ({
      ...previous,
      sessions: {
        ...previous.sessions,
        active: session('active', { interruptReason: 'could not reconnect' }),
      },
    }),
  };
  for (const [name, change] of Object.entries(changes)) {
    assert.equal(visibleStateEqual(change), false, name);
  }
});

test('a new chat shows the message sent from its own place while it starts', () => {
  const [tab] = initialState.tabStrip.tabs;
  const sentFrom = (tileId: string): AppState => ({
    ...initialState,
    pendingCompose: {
      fromTile: { text: 'hi', skills: [], files: [], origin: { tabId: tab.id, tileId } },
    },
  });
  assert.equal(selectChatViewState(sentFrom('left'), null, 'left').startingCompose?.text, 'hi');
  assert.equal(selectChatViewState(sentFrom('left'), null, 'right').startingCompose, undefined);
  assert.equal(selectChatViewState(sentFrom('left'), null, null).startingCompose, undefined);
  assert.equal(selectChatViewState(sentFrom(tab.tileId), null, null).startingCompose?.text, 'hi');
});

test('a new-chat tile offers its own draft while another tile has focus', () => {
  const [tab] = initialState.tabStrip.tabs;
  const page = (cwd: string) => ({
    kind: 'new-chat' as const,
    draft: { cwd, executionMode: 'local' as const },
  });
  const state: AppState = {
    ...initialState,
    draftChat: page('/focused').draft,
    tabStrip: {
      ...initialState.tabStrip,
      tabs: [
        {
          ...tab,
          page: {
            kind: 'tiles',
            grid: {
              columns: [
                { tiles: [{ id: 'left', page: page('/focused') }], rowSplit: 0.5 },
                { tiles: [{ id: 'right', page: page('/beside') }], rowSplit: 0.5 },
              ],
              columnSplit: 0.5,
              focusedTileId: 'left',
            },
          },
        },
      ],
    },
  };
  assert.equal(selectChatViewState(state, null, 'left').draftChat?.cwd, '/focused');
  assert.equal(selectChatViewState(state, null, 'right').draftChat?.cwd, '/beside');
});
