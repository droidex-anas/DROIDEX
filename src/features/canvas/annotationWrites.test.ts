import assert from 'node:assert/strict';
import test from 'node:test';
import type { Annotation, AnnotateCanvasInput } from './annotationProtocol';
import {
  nextExpectedVersion,
  shownMarks,
  unansweredWrites,
  withoutRefused,
} from './annotationWrites';

const rect = { x: 0, y: 0, width: 10, height: 10 };

function saved(id: string): Annotation {
  return {
    id,
    color: 'ink',
    kind: 'rect',
    rect,
    author: { kind: 'agent', chatId: 'chat_1' },
    createdAt: 1,
    updatedAt: 1,
  };
}

function write(mutationId: string, expected: number, change: Partial<AnnotateCanvasInput> = {}) {
  return { mutationId, expectedAnnotationsVersion: expected, upserts: [], deletes: [], ...change };
}

test('writes made faster than the feed answers them chain their expected versions', () => {
  assert.equal(nextExpectedVersion(4, []), 4);
  const first = write('m1', 4);
  const second = write('m2', nextExpectedVersion(4, [first]));
  assert.equal(second.expectedAnnotationsVersion, 5);
  // The feed reaching version 5 answers the first; the second still waits.
  assert.deepEqual(unansweredWrites([first, second], 5), [second]);
  // A refusal takes every write chained on it with it.
  assert.deepEqual(withoutRefused([first, second], 'm1'), []);
  assert.deepEqual(withoutRefused([first, second], 'm2'), [first]);
});

test('unanswered writes are drawn over the layer in order, keeping authors and stacking', () => {
  const moved = { id: 'a', color: 'red', kind: 'rect', rect: { ...rect, x: 50 } } as const;
  const added = { id: 'c', color: 'blue', kind: 'ellipse', rect } as const;
  const marks = shownMarks(
    [saved('a'), saved('b')],
    [write('m1', 0, { upserts: [added, moved] }), write('m2', 1, { deletes: ['b'] })],
  );

  assert.deepEqual(
    marks.map(({ draft, author }) => [draft.id, draft.color, author.kind]),
    [
      ['a', 'red', 'agent'],
      ['c', 'blue', 'user'],
    ],
  );
});
