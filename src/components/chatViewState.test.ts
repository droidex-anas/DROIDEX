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
    selectChatViewState(previous),
    selectChatViewState(change(previous)),
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
