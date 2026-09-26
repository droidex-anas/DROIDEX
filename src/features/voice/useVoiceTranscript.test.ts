import test from 'node:test';
import assert from 'node:assert/strict';
import { initialState, reducer, type AppState } from '../../hooks/useStore';
import { followVoiceTranscript } from './useVoiceTranscript';
import type { VoiceRole } from './voiceSessions';

type Action = Parameters<typeof reducer>[1];

// A store the way the provider exposes it: reduce, then tell every listener.
function storeOf() {
  let state = initialState as AppState;
  const listeners = new Set<() => void>();
  return {
    getState: () => state,
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    dispatch: (action: Action) => {
      state = reducer(state, action);
      for (const listener of listeners) listener();
    },
  };
}

function said(role: VoiceRole, text: string, final: boolean): Action {
  return { type: 'VOICE_TRANSCRIPT', appSessionId: 'm1', role, text, final };
}

test('a spoken line appears at once, its later words are paced, and its end is never held back', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const store = storeOf();
  const shown: string[] = [];
  const stop = followVoiceTranscript(store, 'm1', (lines) => {
    shown.push(lines.map((line) => `${line.text}${line.final ? '.' : '...'}`).join(' | '));
  });
  shown.length = 0;

  store.dispatch(said('assistant', 'The build', false));
  store.dispatch(said('assistant', ' passed', false));
  store.dispatch(said('assistant', ' on main', false));
  assert.deepEqual(shown, ['The build...'], 'the first words open the line at once');

  t.mock.timers.tick(100);
  assert.deepEqual(shown.at(-1), 'The build passed on main...', 'the words since land together');

  store.dispatch(said('assistant', ' today', false));
  store.dispatch(said('assistant', 'The build passed on main today', true));
  assert.deepEqual(
    shown.at(-1),
    'The build passed on main today.',
    'the finished line does not wait for the pending words',
  );
  const settled = shown.length;
  t.mock.timers.tick(100);
  assert.equal(shown.length, settled, 'nothing was left scheduled behind it');

  stop();
});
