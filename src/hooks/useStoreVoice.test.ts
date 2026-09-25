import test from 'node:test';
import assert from 'node:assert/strict';
import { reducer, initialState } from './useStore';
import type { AppState } from './useStore';
import type { VoiceRole } from '../features/voice/voiceSessions';

function said(appSessionId: string, role: VoiceRole, text: string, final: boolean) {
  return { type: 'VOICE_TRANSCRIPT', appSessionId, role, text, final } as const;
}

test('voice transcript updates the live surface without making a chat row', () => {
  let state = initialState as AppState;
  state = reducer(state, said('m1', 'user', 'ship ', false));
  state = reducer(state, said('m1', 'user', 'it', false));
  assert.equal(state.transcripts.m1, undefined);

  state = reducer(state, said('m1', 'user', 'ship it', true));
  state = reducer(state, said('m1', 'user', 'ship it', true));

  assert.equal(state.transcripts.m1, undefined);
  assert.deepEqual(
    state.voiceSessions.m1.lines.map((line) => line.text),
    ['ship it'],
  );
});

test('sidecar transcript rows keep both speakers and their spoken mark', () => {
  let state = initialState as AppState;
  state = reducer(state, {
    type: 'SESSION_TRANSCRIPT',
    event: {
      id: 'voice-user',
      appSessionId: 'm1',
      sourceSessionId: 'user',
      role: 'primary',
      ts: 1,
      kind: 'text',
      text: 'what changed?',
      author: 'user',
      spoken: true,
    },
  });
  state = reducer(state, {
    type: 'SESSION_TRANSCRIPT',
    event: {
      id: 'voice-assistant',
      appSessionId: 'm1',
      sourceSessionId: 'primary',
      role: 'primary',
      ts: 2,
      kind: 'text',
      text: 'the composer',
      spoken: true,
    },
  });
  state = reducer(state, {
    type: 'SESSION_TRANSCRIPT',
    event: {
      id: 'typed-1',
      appSessionId: 'm1',
      sourceSessionId: 'primary',
      role: 'primary',
      ts: 3,
      kind: 'text',
      text: 'and the sidebar',
    },
  });

  assert.deepEqual(
    state.transcripts.m1.map((row) => [row.text, row.author, row.spoken]),
    [
      ['what changed?', 'user', true],
      ['the composer', undefined, true],
      ['and the sidebar', undefined, undefined],
    ],
  );
});

test('a corrected sidecar spoken row grows in place', () => {
  const event = {
    id: 'voice-user',
    appSessionId: 'm1',
    sourceSessionId: 'user',
    role: 'primary' as const,
    ts: 1,
    kind: 'text' as const,
    text: 'please',
    author: 'user' as const,
    spoken: true,
  };
  let state = reducer(initialState as AppState, { type: 'SESSION_TRANSCRIPT', event });
  state = reducer(state, {
    type: 'SESSION_TRANSCRIPT',
    event: { ...event, text: 'please check' },
  });
  assert.deepEqual(
    state.transcripts.m1.map((row) => row.text),
    ['please check'],
  );
});

test('each speaker keeps its own line while both are talking', () => {
  let state = initialState as AppState;
  state = reducer(state, { type: 'VOICE_CONNECTING', appSessionId: 'm1' });
  state = reducer(state, said('m1', 'assistant', 'Let me ', false));
  // The user starts talking over the reply, and what they said is transcribed
  // before the reply has finished.
  state = reducer(state, said('m1', 'user', 'wait', true));
  state = reducer(state, said('m1', 'assistant', 'check that.', false));
  state = reducer(state, said('m1', 'assistant', 'Let me check that.', true));

  assert.deepEqual(
    state.voiceSessions.m1.lines.map((line) => [line.role, line.text, line.final]),
    [
      ['assistant', 'Let me check that.', true],
      ['user', 'wait', true],
    ],
  );
  assert.equal(state.transcripts.m1, undefined);
});

test('voice surface starts fresh after a session switch and a second conversation', () => {
  let state = initialState as AppState;
  state = reducer(state, { type: 'VOICE_CONNECTING', appSessionId: 'm1' });
  state = reducer(state, said('m1', 'user', 'first', true));
  state = reducer(state, { type: 'VOICE_ENDED', appSessionId: 'm1' });
  state = reducer(state, { type: 'SET_ACTIVE_SESSION', id: 'm2' });
  state = reducer(state, said('m2', 'user', 'elsewhere', true));
  state = reducer(state, { type: 'SET_ACTIVE_SESSION', id: 'm1' });
  state = reducer(state, { type: 'SESSION_CLOSED', appSessionId: 'm1' });
  state = reducer(state, { type: 'VOICE_CONNECTING', appSessionId: 'm1' });
  state = reducer(state, said('m1', 'user', 'second', true));

  assert.deepEqual(
    state.voiceSessions.m1.lines.map((line) => line.text),
    ['second'],
  );
  assert.equal(state.transcripts.m1, undefined);
  assert.equal(state.transcripts.m2, undefined);
});
