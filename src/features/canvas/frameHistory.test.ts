import assert from 'node:assert/strict';
import { test } from 'node:test';
import { CanvasRequestError } from './client';
import { CHANGED_SINCE_READ, FrameHistory, revisionNumber } from './frameHistory';
import type { RevisionSummary, SwitchRevisionInput } from './protocol';

function revision(revisionId: string, version: number): RevisionSummary {
  return {
    revisionId,
    version,
    sequence: version,
    author: { kind: 'user' },
    mutationKind: 'write',
    state: 'saved',
    createdAt: version,
    designSystem: { id: 'droidex', version: 1, mode: 'dark' },
    buildStatus: 'ready',
  };
}

/** A client whose every answer the test gives by hand. */
function fakeClient() {
  const lists: (PromiseWithResolvers<RevisionSummary[]> & { designId: string })[] = [];
  const switches: (PromiseWithResolvers<unknown> & SwitchRevisionInput)[] = [];
  const history = new FrameHistory({
    listRevisions: (designId) => {
      const answer = Promise.withResolvers<RevisionSummary[]>();
      lists.push({ ...answer, designId });
      return answer.promise;
    },
    switchRevision: (input) => {
      const answer = Promise.withResolvers();
      switches.push({ ...answer, ...input });
      return answer.promise;
    },
  });
  return { history, lists, switches };
}

test('a switch moves off the head its versions were read against, once at a time', async () => {
  const { history, lists, switches } = fakeClient();
  history.show({ designId: 'a', headRevisionId: 'r2' });
  lists[0].resolve([revision('r2', 2), revision('r1', 1)]);
  await Promise.resolve();
  assert.equal(revisionNumber(history.read(), 'r2'), 2);

  assert.equal(await history.switchTo('r2'), null);
  const switching = history.switchTo('r1');
  void history.switchTo('r1');
  assert.deepEqual(
    switches.map(({ designId, revisionId, expectedRevisionId }) => ({
      designId,
      revisionId,
      expectedRevisionId,
    })),
    [{ designId: 'a', revisionId: 'r1', expectedRevisionId: 'r2' }],
  );
  switches[0].resolve(undefined);
  assert.equal(await switching, null);
  // The new head arrives with the canvas, and its versions are read again.
  history.show({ designId: 'a', headRevisionId: 'r1' });
  assert.deepEqual(history.read(), { status: 'loading' });
  assert.equal(lists.length, 2);
});

test('answers for a frame no longer shown change nothing', async () => {
  const { history, lists, switches } = fakeClient();
  history.show({ designId: 'a', headRevisionId: 'r2' });
  lists[0].resolve([revision('r2', 2), revision('r1', 1)]);
  await Promise.resolve();
  const switching = history.switchTo('r1');

  history.show({ designId: 'b', headRevisionId: 'q1' });
  switches[0].reject(new CanvasRequestError('scope_expired', 'This chat left that canvas.'));
  assert.equal(await switching, null);
  assert.deepEqual(history.read(), { status: 'loading' });

  history.dispose();
  lists[1].resolve([revision('q1', 1)]);
  await Promise.resolve();
  assert.deepEqual(history.read(), { status: 'loading' });
});

test('a switch refused because the head moved says so and reads the versions again', async () => {
  const { history, lists, switches } = fakeClient();
  history.show({ designId: 'a', headRevisionId: 'r2' });
  lists[0].resolve([revision('r2', 2), revision('r1', 1)]);
  await Promise.resolve();
  const switching = history.switchTo('r1');
  switches[0].reject(new CanvasRequestError('revision_conflict', 'The head moved.'));
  assert.equal(await switching, CHANGED_SINCE_READ);
  assert.deepEqual(history.read(), { status: 'loading' });
  assert.equal(lists.length, 2);
});
