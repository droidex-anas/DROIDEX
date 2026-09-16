import test from 'node:test';
import assert from 'node:assert/strict';
import { reducer, initialState } from './useStore';
import type { AppState } from './useStore';
import type { TranscriptEvent } from '../types/bridge';

function delta(
  id: string,
  toolUseId: string,
  args: Record<string, unknown>,
  ts: number,
  sourceSessionId = 'primary',
) {
  return {
    type: 'SESSION_TRANSCRIPT',
    event: {
      id,
      appSessionId: 'm1',
      sourceSessionId,
      kind: 'tool_call',
      toolName: 'edit',
      toolUseId,
      toolArgs: args,
      ts,
    } as TranscriptEvent,
  } as const;
}

test('EVENT_APPENDED coalesces tool_call deltas sharing one toolUseId into one event', () => {
  let state = initialState as AppState;
  state = reducer(state, delta('d1', 'edit-1', { path: 'a.ts', new_string: 'x' }, 1));
  state = reducer(state, delta('d2', 'edit-1', { path: 'a.ts', new_string: 'xy' }, 2));
  state = reducer(state, delta('d3', 'edit-1', { path: 'a.ts', new_string: 'xyz' }, 3));

  const events = state.transcripts.m1;
  assert.equal(events.length, 1);
  // Stable id is kept from the first delta; latest args + endTs are adopted.
  assert.equal(events[0].id, 'd1');
  assert.deepEqual(events[0].toolArgs, { path: 'a.ts', new_string: 'xyz' });
  assert.equal(events[0].endTs, 3);
});

test('EVENT_APPENDED merges partial delta args instead of dropping earlier fields', () => {
  let state = initialState as AppState;
  // A Task spawn streams its fields across separate deltas; a later payload-less
  // delta must not erase the accumulated args.
  state = reducer(state, delta('d1', 'task-1', { subagent_type: 'worker' }, 1));
  state = reducer(state, delta('d2', 'task-1', { description: 'do the thing' }, 2));
  state = reducer(state, delta('d3', 'task-1', {}, 3));

  const events = state.transcripts.m1;
  assert.equal(events.length, 1);
  assert.equal(events[0].id, 'd1');
  assert.deepEqual(events[0].toolArgs, {
    subagent_type: 'worker',
    description: 'do the thing',
  });
  assert.equal(events[0].endTs, 3);
});

test('EVENT_APPENDED keeps tool_calls with distinct toolUseIds separate', () => {
  let state = initialState as AppState;
  state = reducer(state, delta('d1', 'edit-1', { path: 'a.ts' }, 1));
  state = reducer(state, delta('d2', 'edit-2', { path: 'b.ts' }, 2));

  const events = state.transcripts.m1;
  assert.equal(events.length, 2);
  assert.equal(events[0].toolUseId, 'edit-1');
  assert.equal(events[1].toolUseId, 'edit-2');
});

test('EVENT_APPENDED does not let a cross-session id collision steal the merge target', () => {
  let state = initialState as AppState;
  state = reducer(state, delta('a1', 'edit-1', { path: 'a.ts', new_string: 'x' }, 1, 'primary'));
  // A child session streams a call whose provider id matches the primary's.
  state = reducer(state, delta('b1', 'edit-1', { path: 'b.ts', new_string: 'y' }, 2, 'child-1'));
  // The primary's next delta must still merge into its own event, not append
  // a duplicate because the child overwrote the index entry.
  state = reducer(state, delta('a2', 'edit-1', { path: 'a.ts', new_string: 'xy' }, 3, 'primary'));
  state = reducer(state, delta('b2', 'edit-1', { path: 'b.ts', new_string: 'yz' }, 4, 'child-1'));

  const events = state.transcripts.m1;
  assert.equal(events.length, 2);
  assert.equal(events[0].id, 'a1');
  assert.deepEqual(events[0].toolArgs, { path: 'a.ts', new_string: 'xy' });
  assert.equal(events[1].id, 'b1');
  assert.deepEqual(events[1].toolArgs, { path: 'b.ts', new_string: 'yz' });
});
