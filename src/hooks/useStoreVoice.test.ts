import test from 'node:test';
import assert from 'node:assert/strict';
import { reducer, initialState } from './useStore';
import type { AppState } from './useStore';
import type { VoiceRole } from '../features/voice/voiceSessions';

function said(appSessionId: string, role: VoiceRole, text: string, final: boolean) {
  return { type: 'VOICE_TRANSCRIPT', appSessionId, role, text, final } as const;
}

test('a finished utterance becomes a chat row, once, however often it is announced', () => {
  let state = initialState as AppState;
  state = reducer(state, said('m1', 'user', 'ship ', false));
  state = reducer(state, said('m1', 'user', 'it', false));
  // Nothing lands in the chat while the speaker is still talking.
  assert.equal(state.transcripts.m1, undefined);

  state = reducer(state, said('m1', 'user', 'ship it', true));
  state = reducer(state, said('m1', 'user', 'ship it', true));

  const rows = state.transcripts.m1;
  assert.equal(rows.length, 1);
  assert.equal(rows[0].text, 'ship it');
  assert.equal(rows[0].author, 'user');
  assert.equal(rows[0].spoken, true);
});

test('both sides of a spoken exchange are kept, and only spoken rows carry the mark', () => {
  let state = initialState as AppState;
  state = reducer(state, said('m1', 'user', 'what changed?', true));
  state = reducer(state, said('m1', 'assistant', 'the composer', true));
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

test('each speaker keeps its own line while both are talking', () => {
  let state = initialState as AppState;
  state = reducer(state, { type: 'VOICE_CONNECTING', appSessionId: 'm1', startedAt: 1 });
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
  assert.deepEqual(
    state.transcripts.m1.map((row) => row.text),
    ['wait', 'Let me check that.'],
  );
});

test('spoken rows stay with their chat across a session switch and a second voice session', () => {
  let state = initialState as AppState;
  state = reducer(state, { type: 'VOICE_CONNECTING', appSessionId: 'm1', startedAt: 1 });
  state = reducer(state, said('m1', 'user', 'first', true));
  state = reducer(state, { type: 'VOICE_ENDED', appSessionId: 'm1' });
  state = reducer(state, { type: 'SET_ACTIVE_SESSION', id: 'm2' });
  state = reducer(state, said('m2', 'user', 'elsewhere', true));
  state = reducer(state, { type: 'SET_ACTIVE_SESSION', id: 'm1' });
  // Retiring the idle runtime drops what the renderer knew about the chat's
  // voice, so the next conversation counts its lines from one again while the
  // transcript keeps the rows the first one wrote.
  state = reducer(state, { type: 'SESSION_CLOSED', appSessionId: 'm1' });
  state = reducer(state, { type: 'VOICE_CONNECTING', appSessionId: 'm1', startedAt: 2 });
  state = reducer(state, said('m1', 'user', 'second', true));

  // The new conversation starts with an empty surface but keeps writing new
  // rows, so the reopened chat shows everything that was ever said in it.
  assert.deepEqual(
    state.voiceSessions.m1.lines.map((line) => line.text),
    ['second'],
  );
  assert.deepEqual(
    state.transcripts.m1.map((row) => row.text),
    ['first', 'second'],
  );
  assert.deepEqual(
    state.transcripts.m2.map((row) => row.text),
    ['elsewhere'],
  );
});
