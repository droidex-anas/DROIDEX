import assert from 'node:assert/strict';
import test from 'node:test';
import type { Annotation, AnnotateCanvasInput } from './annotationProtocol';
import {
  AnnotationWriteQueue,
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

test('a write waits for the one before it, and a refusal drops the queue unsent', async () => {
  const sent: string[] = [];
  const replies = new Map<string, { resolve: () => void; reject: (error: Error) => void }>();
  let refused: (input: AnnotateCanvasInput) => void = () => undefined;
  const queue = new AnnotationWriteQueue(
    (input) => {
      sent.push(input.mutationId);
      return new Promise<void>((resolve, reject) =>
        replies.set(input.mutationId, { resolve, reject }),
      );
    },
    (input) => refused(input),
  );
  const settle = () => new Promise<void>((resolve) => setImmediate(resolve));
  const drawn = { id: 'n', color: 'red', kind: 'rect', rect } as const;
  const first = write('m1', 4, { upserts: [drawn] });
  const second = write('m2', 5, { upserts: [{ ...drawn, color: 'blue' }] });
  const third = write('m3', 6, { deletes: ['b'] });

  queue.push(first);
  queue.push(second);
  assert.deepEqual(sent, ['m1']);
  replies.get('m1')?.resolve();
  await settle();
  assert.deepEqual(sent, ['m1', 'm2']);

  // Another writer moved the layer, so m2 is refused while m3 waits behind it.
  queue.push(third);
  const refusal = new Promise<AnnotateCanvasInput>((resolve) => (refused = resolve));
  replies.get('m2')?.reject(new Error('revision_conflict'));
  const dropped = await refusal;
  queue.push(write('m4', 5));
  assert.deepEqual(sent, ['m1', 'm2', 'm4']);
  // The board shows neither the refused write nor the one queued behind it.
  const shown = withoutRefused([second, third], dropped.mutationId);
  assert.deepEqual(
    shownMarks([saved('b')], shown).map(({ draft }) => draft.id),
    ['b'],
  );
});
