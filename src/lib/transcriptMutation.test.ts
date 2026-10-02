import assert from 'node:assert/strict';
import test from 'node:test';
import {
  aggregateTranscriptMutationBatch,
  aggregateTranscriptMutations,
  detectPureTranscriptPrepend,
  nextTranscriptMutation,
  observeTranscriptMutationChanges,
  type TranscriptMutation,
} from './transcriptMutation';

const reference = (id: string) => ({ id });

/** The mutation at `revision`, one step after its base revision. */
function mutation(
  kind: TranscriptMutation['kind'],
  revision: number,
  previousLength: number,
  firstChangedIndex: number,
  insertedCount?: number,
): TranscriptMutation {
  return {
    revision,
    baseRevision: revision - 1,
    kind,
    previousLength,
    firstChangedIndex,
    ...(insertedCount === undefined ? {} : { insertedCount }),
  };
}

test('pure prepend detection records one exact insertion without scanning semantics', () => {
  const retained = [reference('b'), reference('c')];
  const older = [reference('a')];

  assert.deepEqual(detectPureTranscriptPrepend(retained, [...older, ...retained]), {
    kind: 'prepend',
    previousLength: 2,
    firstChangedIndex: 0,
    insertedCount: 1,
  });

  const prefix = reference('prefix');
  assert.deepEqual(
    detectPureTranscriptPrepend([prefix, ...retained], [prefix, ...older, ...retained]),
    {
      kind: 'prepend',
      previousLength: 3,
      firstChangedIndex: 1,
      insertedCount: 1,
    },
  );
});

test('prepend detection rejects replacement, removal, and cloned retained entries', () => {
  const first = reference('a');
  const second = reference('b');

  assert.equal(detectPureTranscriptPrepend([first, second], [reference('x'), second]), undefined);
  assert.equal(detectPureTranscriptPrepend([first, second], [first]), undefined);
  assert.equal(
    detectPureTranscriptPrepend([first, second], [reference('older'), { ...first }, second]),
    undefined,
  );
});

test('aggregation preserves one linked prepend and resets mixed mutation chains', () => {
  const prepend = mutation('prepend', 11, 100, 0, 40);

  assert.deepEqual(aggregateTranscriptMutations(10, [prepend]), prepend);
  const mixed = aggregateTranscriptMutations(10, [prepend, mutation('append', 12, 140, 140)]);
  assert.ok(mixed);
  assert.equal(mixed.kind, 'reset');
});

test('aggregation combines a contiguous append chain from the batch boundary', () => {
  const records: TranscriptMutation[] = [
    mutation('append', 11, 5, 5),
    mutation('append', 12, 6, 4),
    mutation('append', 13, 6, 6),
  ];

  assert.deepEqual(aggregateTranscriptMutations(10, records), {
    revision: 13,
    baseRevision: 10,
    kind: 'append',
    previousLength: 5,
    firstChangedIndex: 4,
  });
  assert.equal(aggregateTranscriptMutations(13, []), undefined);
});

test('aggregation conservatively resets for an explicit reset or revision gap', () => {
  const explicitReset: TranscriptMutation[] = [
    mutation('append', 5, 8, 8),
    mutation('reset', 6, 9, 3),
  ];
  const lateAppend = mutation('append', 8, 3, 3);
  const revisionGap: TranscriptMutation[] = [lateAppend, mutation('append', 10, 4, 4)];

  assert.deepEqual(aggregateTranscriptMutations(4, explicitReset), {
    revision: 6,
    baseRevision: 4,
    kind: 'reset',
    previousLength: 8,
    firstChangedIndex: 0,
  });
  assert.deepEqual(aggregateTranscriptMutations(7, revisionGap), {
    revision: 10,
    baseRevision: 7,
    kind: 'reset',
    previousLength: 3,
    firstChangedIndex: 0,
  });
  const gapped = aggregateTranscriptMutations(6, [lateAppend]);
  assert.ok(gapped);
  assert.equal(gapped.kind, 'reset');
});

test('mutation helpers reject invalid transcript indices', () => {
  assert.throws(
    () =>
      nextTranscriptMutation(undefined, {
        kind: 'append',
        previousLength: -1,
        firstChangedIndex: 0,
      }),
    RangeError,
  );
  assert.throws(
    () =>
      nextTranscriptMutation(undefined, {
        kind: 'append',
        previousLength: 2,
        firstChangedIndex: 3,
      }),
    RangeError,
  );
  assert.throws(
    () =>
      aggregateTranscriptMutations(0, [
        {
          revision: 1,
          baseRevision: 0,
          kind: 'append',
          previousLength: 1,
          firstChangedIndex: 0.5,
        },
      ]),
    RangeError,
  );
});

test('mutation observation records only new and changed sessions', () => {
  const sessionA = mutation('append', 3, 2, 2);
  const sessionB = mutation('append', 8, 5, 5);
  const changedSessionA = mutation('append', 4, 3, 3);
  const newSession = mutation('append', 1, 0, 0);
  const before = { 'session-a': sessionA, 'session-b': sessionB };
  const after = {
    'session-a': changedSessionA,
    'session-b': sessionB,
    'session-c': newSession,
  };
  const records = new Map<string, TranscriptMutation[]>();

  observeTranscriptMutationChanges(records, before, after);
  observeTranscriptMutationChanges(records, after, after);

  assert.deepEqual(
    records,
    new Map([
      ['session-a', [changedSessionA]],
      ['session-c', [newSession]],
    ]),
  );
});

test('batch aggregation combines multiple sessions and preserves no-op map identity', () => {
  const sessionAStart = mutation('append', 10, 4, 4);
  const sessionAFirst = mutation('append', 11, 5, 5);
  const sessionAFinal = mutation('append', 12, 6, 4);
  const sessionBStart = mutation('append', 20, 2, 2);
  const sessionBFinal = mutation('reset', 21, 2, 0);
  const unchanged = mutation('append', 2, 1, 1);
  const batchStart = {
    'session-a': sessionAStart,
    'session-b': sessionBStart,
    unchanged,
  };
  const final = {
    'session-a': sessionAFinal,
    'session-b': sessionBFinal,
    unchanged,
  };
  const records = new Map([
    ['session-a', [sessionAFirst, sessionAFinal]],
    ['session-b', [sessionBFinal]],
  ]);

  const result = aggregateTranscriptMutationBatch(batchStart, final, records);

  assert.notEqual(result, final);
  assert.equal(result.unchanged, unchanged);
  assert.deepEqual(result['session-a'], {
    revision: 12,
    baseRevision: 10,
    kind: 'append',
    previousLength: 5,
    firstChangedIndex: 4,
  });
  assert.deepEqual(result['session-b'], mutation('reset', 21, 2, 0));
  assert.equal(aggregateTranscriptMutationBatch(batchStart, final, new Map()), final);
});

test('deletion-only batches keep the final mutation map unchanged', () => {
  const batchStart = { 'session-a': mutation('append', 4, 3, 3) };
  const final: Record<string, TranscriptMutation> = {};
  const records = new Map<string, TranscriptMutation[]>();

  observeTranscriptMutationChanges(records, batchStart, final);

  assert.equal(records.size, 0);
  assert.equal(aggregateTranscriptMutationBatch(batchStart, final, records), final);
});

test('batch aggregation keeps recreated sessions on their restarted revision lineage', () => {
  const previous = mutation('append', 9, 7, 7);
  const restarted = mutation('append', 1, 0, 0);
  const batchStart = { 'session-a': previous };
  const recreated = { 'session-a': restarted };
  const records = new Map<string, TranscriptMutation[]>();

  observeTranscriptMutationChanges(records, batchStart, {});
  observeTranscriptMutationChanges(records, {}, recreated);

  const restartedReset = mutation('reset', 1, 0, 0);
  assert.deepEqual(aggregateTranscriptMutationBatch(batchStart, recreated, records), {
    'session-a': restartedReset,
  });
  // The same lineage holds after the batch record was pruned.
  assert.deepEqual(aggregateTranscriptMutations(9, [restarted]), restartedReset);
});
