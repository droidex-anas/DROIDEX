import assert from 'node:assert/strict';
import { test } from 'node:test';
import { CanvasRequestError } from './client';
import { CHANGED_SINCE_READ, FrameHistory } from './frameHistory';
import type { RestoreRevisionInput, RevisionSummary } from './protocol';

function revision(revisionId: string, sequence: number): RevisionSummary {
  return {
    revisionId,
    sequence,
    author: { kind: 'user' },
    mutationKind: 'write',
    state: 'saved',
    createdAt: sequence,
    designSystem: { id: 'droidex', version: 1, mode: 'dark' },
    buildStatus: 'ready',
  };
}

/** A client whose every answer the test gives by hand. */
function fakeClient() {
  const lists: (PromiseWithResolvers<RevisionSummary[]> & { designId: string })[] = [];
  const restores: (PromiseWithResolvers<unknown> & RestoreRevisionInput)[] = [];
  const history = new FrameHistory({
    listRevisions: (designId) => {
      const answer = Promise.withResolvers<RevisionSummary[]>();
      lists.push({ ...answer, designId });
      return answer.promise;
    },
    restoreRevision: (input) => {
      const answer = Promise.withResolvers();
      restores.push({ ...answer, ...input });
      return answer.promise;
    },
  });
  return { history, lists, restores };
}

test('a restore writes over the head it was confirmed against and settles once written', async () => {
  const { history, lists, restores } = fakeClient();
  history.show({ designId: 'a', headRevisionId: 'r2' });
  lists[0].resolve([revision('r2', 2), revision('r1', 1)]);
  await Promise.resolve();
  assert.deepEqual(history.read().list, {
    status: 'listed',
    revisions: [revision('r2', 2), revision('r1', 1)],
    complete: true,
  });

  history.confirm('r1');
  const restoring = history.restore();
  assert.deepEqual(
    restores.map(({ designId, revisionId, expectedRevisionId }) => ({
      designId,
      revisionId,
      expectedRevisionId,
    })),
    [{ designId: 'a', revisionId: 'r1', expectedRevisionId: 'r2' }],
  );
  // The restore's own write moves the head before its reply arrives.
  history.show({ designId: 'a', headRevisionId: 'r3' });
  assert.deepEqual(history.read().restore, { status: 'restoring', revisionId: 'r1' });
  restores[0].resolve(undefined);
  assert.equal(await restoring, true);
  assert.deepEqual(history.read().restore, { status: 'idle' });
  assert.deepEqual(
    lists.map((read) => read.designId),
    ['a', 'a'],
  );
});

test('answers for a frame no longer shown change nothing', async () => {
  const { history, lists, restores } = fakeClient();
  history.show({ designId: 'a', headRevisionId: 'r2' });
  lists[0].resolve([revision('r2', 2), revision('r1', 1)]);
  await Promise.resolve();
  history.confirm('r1');
  const restoring = history.restore();

  history.show({ designId: 'b', headRevisionId: 'q1' });
  restores[0].reject(new CanvasRequestError('scope_expired', 'This chat left that canvas.'));
  assert.equal(await restoring, false);
  assert.deepEqual(history.read(), { list: { status: 'loading' }, restore: { status: 'idle' } });

  history.dispose();
  lists[1].resolve([revision('q1', 3)]);
  await Promise.resolve();
  assert.deepEqual(history.read().list, { status: 'loading' });
});

test('a restore refused because the head moved says so and reads the history again', async () => {
  const { history, lists, restores } = fakeClient();
  history.show({ designId: 'a', headRevisionId: 'r2' });
  lists[0].resolve([revision('r2', 2), revision('r1', 1)]);
  await Promise.resolve();
  history.confirm('r1');
  const restoring = history.restore();
  restores[0].reject(new CanvasRequestError('revision_conflict', 'The head moved.'));
  assert.equal(await restoring, false);
  assert.deepEqual(history.read(), {
    list: { status: 'loading' },
    restore: { status: 'refused', message: CHANGED_SINCE_READ },
  });
  assert.equal(lists.length, 2);
});
