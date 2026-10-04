import assert from 'node:assert/strict';
import test from 'node:test';
import type { ChildSessionSummary, SessionSummary, TranscriptEvent } from '../../types/bridge';
import { initialState, shallowEqual, type AppState } from '../../hooks/useStore';
import { selectDockedAgents } from './ComposerDock';

function event(id: string): TranscriptEvent {
  return {
    id,
    appSessionId: 'session-a',
    sourceSessionId: 'primary',
    role: 'primary',
    kind: 'text',
    author: 'assistant',
    text: id,
    ts: 1,
  };
}

test('the docked agent line reads no transcript, so a streamed token cannot re-render it', () => {
  // The composer sits on the per-token path. The docked line's source must stay
  // identical across a transcript append, or every token would rebuild its rows.
  const child: ChildSessionSummary = {
    parentAppSessionId: 'session-a',
    childSessionId: 'child-a',
    role: 'worker',
    status: 'running',
    modelId: 'droid-core',
    transcriptAvailable: true,
    startedAt: 1,
    streamFidelity: 'token',
  };
  const session: SessionSummary = {
    appSessionId: 'session-a',
    provider: 'droid',
    sessionPurpose: 'chat',
    interactionMode: 'auto',
    role: 'primary',
    title: 'session-a',
    goal: '',
    cwd: '',
    autonomy: 'off',
    phase: 'running',
    features: [],
    tokensIn: 0,
    tokensOut: 0,
    contextTokens: 0,
    createdAt: 1,
    updatedAt: 1,
  };
  const base: AppState = {
    ...initialState,
    activeAppSessionId: 'session-a',
    sessions: { 'session-a': session },
    childSessions: { 'session-a': { 'child-a': child } },
    transcripts: { 'session-a': [event('a')] },
  };
  const streamed: AppState = { ...base, transcripts: { 'session-a': [event('a'), event('b')] } };
  assert.equal(shallowEqual(selectDockedAgents(base), selectDockedAgents(streamed)), true);

  // A child that actually changed does reach it.
  const settled: AppState = {
    ...base,
    childSessions: { 'session-a': { 'child-a': { ...child, status: 'completed' } } },
  };
  assert.equal(shallowEqual(selectDockedAgents(base), selectDockedAgents(settled)), false);
});
