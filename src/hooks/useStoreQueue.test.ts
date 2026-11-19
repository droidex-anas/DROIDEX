import assert from 'node:assert/strict';
import test from 'node:test';
import type { QueuedPrompt } from '../lib/promptQueue';
import { initialState, reducer } from './useStore';

const prompt = (id: string): QueuedPrompt => ({ id, text: id, skills: [], files: [] });

test('queued prompts append, reorder, and remove only in their target chat', () => {
  const other = [prompt('other')];
  const start = { ...initialState, promptQueue: { other } };
  const first = prompt('first');
  const second = prompt('second');
  const queued = reducer(
    reducer(start, { type: 'QUEUE_PROMPT', appSessionId: 'chat', prompt: first }),
    {
      type: 'QUEUE_PROMPT',
      appSessionId: 'chat',
      prompt: second,
    },
  );
  assert.deepEqual(queued.promptQueue.chat, [first, second]);

  const reordered = reducer(queued, {
    type: 'REORDER_QUEUE',
    appSessionId: 'chat',
    from: 0,
    to: 1,
  });
  assert.deepEqual(reordered.promptQueue.chat, [second, first]);
  assert.deepEqual(queued.promptQueue.chat, [first, second]);

  const removed = reducer(reordered, {
    type: 'REMOVE_QUEUED_PROMPT',
    appSessionId: 'chat',
    id: 'second',
  });
  assert.deepEqual(removed.promptQueue.chat, [first]);
  assert.deepEqual(reordered.promptQueue.chat, [second, first]);
  assert.equal(removed.promptQueue.other, other);
  assert.deepEqual(start.promptQueue, { other });
});

test('removing from an absent queue creates an empty queue and missing IDs preserve its contents', () => {
  const empty = reducer(initialState, {
    type: 'REMOVE_QUEUED_PROMPT',
    appSessionId: 'chat',
    id: 'missing',
  });
  assert.deepEqual(empty.promptQueue.chat, []);
  const queued = reducer(empty, {
    type: 'QUEUE_PROMPT',
    appSessionId: 'chat',
    prompt: prompt('first'),
  });
  const unchanged = reducer(queued, {
    type: 'REMOVE_QUEUED_PROMPT',
    appSessionId: 'chat',
    id: 'missing',
  });
  assert.deepEqual(unchanged.promptQueue.chat, queued.promptQueue.chat);
});

test('empty, unchanged, and out-of-range queue reorders are no-ops', () => {
  assert.equal(
    reducer(initialState, { type: 'REORDER_QUEUE', appSessionId: 'chat', from: 0, to: 1 }),
    initialState,
  );
  const state = { ...initialState, promptQueue: { chat: [prompt('first'), prompt('second')] } };
  for (const [from, to] of [
    [0, 0],
    [-1, 0],
    [0, -1],
    [2, 0],
    [0, 2],
  ]) {
    assert.equal(reducer(state, { type: 'REORDER_QUEUE', appSessionId: 'chat', from, to }), state);
  }
});
