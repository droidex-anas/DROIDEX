import assert from 'node:assert/strict';
import test from 'node:test';
import { initialState, reducer } from './useStore';

// Note rules (blank input, bounds, used stamps) are owned by
// src/lib/sessionNotes.test.ts; this suite covers the reducer wiring.

test('session notes stack newest first per session and remove cleanly', () => {
  const first = reducer(initialState, {
    type: 'SESSION_NOTE_ADD',
    appSessionId: 's1',
    text: 'first note',
  });
  const second = reducer(first, { type: 'SESSION_NOTE_ADD', appSessionId: 's1', text: 'second' });
  assert.deepEqual(
    second.sessionNotes.s1.map((note) => note.text),
    ['second', 'first note'],
  );

  // Notes from another session are untouched.
  const other = reducer(second, { type: 'SESSION_NOTE_ADD', appSessionId: 's2', text: 'other' });
  assert.equal(other.sessionNotes.s1.length, 2);
  assert.equal(other.sessionNotes.s2.length, 1);

  const id = other.sessionNotes.s1[0].id;
  const removed = reducer(other, { type: 'SESSION_NOTE_REMOVE', appSessionId: 's1', noteId: id });
  assert.deepEqual(
    removed.sessionNotes.s1.map((note) => note.text),
    ['first note'],
  );

  const emptied = reducer(removed, {
    type: 'SESSION_NOTE_REMOVE',
    appSessionId: 's1',
    noteId: removed.sessionNotes.s1[0].id,
  });
  assert.equal(emptied.sessionNotes.s1, undefined);
});
