import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createCropMutations,
  createPendingAdditions,
  insertBySequence,
  itemsBeforeCutoff,
  pathsInSequence,
  saveImageUnlessStale,
  type AttachedImage,
} from './useImageAttachments';

const img = (id: string): AttachedImage => ({
  id,
  path: `/tmp/${id}.png`,
  preview: `data:${id}`,
  sequence: 0,
});

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

const tick = () => new Promise<void>((resolve) => setImmediate(resolve));

test('insertBySequence keeps paste order, puts unreserved images last, and copies the list', () => {
  // Pasted a, b, c in that order; the variably slow encodes finish c, a, b.
  const sequences = new Map([
    ['a', 0],
    ['b', 1],
    ['c', 2],
  ]);
  const first = insertBySequence([], img('c'), sequences);
  const second = insertBySequence(first, img('a'), sequences);
  const third = insertBySequence(second, img('b'), sequences);
  assert.deepEqual(
    third.map((i) => i.id),
    ['a', 'b', 'c'],
  );
  assert.deepEqual(
    first.map((i) => i.id),
    ['c'],
  );
  assert.deepEqual(
    insertBySequence(third, img('late'), sequences).map((i) => i.id),
    ['a', 'b', 'c', 'late'],
  );
});

test('settled keeps waiting when an addition starts mid-wait', async () => {
  // Regression for the submit race: a paste that begins while runSubmit is
  // already awaiting still has to land before the snapshot is taken.
  const additions = createPendingAdditions();
  const first = deferred();
  const second = deferred();
  additions.track(first.promise);
  let settled = false;
  const waiting = additions.settled().then(() => {
    settled = true;
  });
  additions.track(second.promise);
  first.resolve();
  await tick();
  assert.equal(settled, false);
  second.resolve();
  await waiting;
  assert.equal(settled, true);
});

test('knownSettled ignores additions that start after the snapshot', async () => {
  const additions = createPendingAdditions();
  const first = deferred();
  const second = deferred();
  additions.track(first.promise);
  const waiting = additions.knownSettled();
  additions.track(second.promise);
  first.resolve();
  await waiting;
  second.resolve();
});

test('submit waits for a crop that starts while an addition is still encoding', async () => {
  const additions = createPendingAdditions();
  const crops = createCropMutations();
  const add = deferred();
  const crop = deferred();
  additions.track(add.promise);
  let ready = false;
  const waiting = (async () => {
    await additions.knownSettled();
    await crops.waitBeforeCutoff(1);
    ready = true;
  })();
  crops.track(0, crop.promise);
  add.resolve();
  await tick();
  assert.equal(ready, false);
  crop.resolve();
  await waiting;
  assert.equal(ready, true);
});

test('submit does not wait for a crop of an attachment past cutoff', async () => {
  const crops = createCropMutations();
  const crop = deferred();
  crops.track(1, crop.promise);
  await crops.waitBeforeCutoff(1);
  crop.resolve();
});

test('submit takes only attachments reserved before its cutoff, in intake order', () => {
  const sequences = new Map([
    ['a', 0],
    ['b', 1],
    ['late', 2],
  ]);
  assert.deepEqual(
    itemsBeforeCutoff([img('a'), img('b'), img('late')], sequences, 2).map((item) => item.id),
    ['a', 'b'],
  );
  assert.deepEqual(
    pathsInSequence([
      { path: '/tmp/notes.pdf', sequence: 1 },
      { path: '/tmp/shot.png', sequence: 0 },
    ]),
    ['/tmp/shot.png', '/tmp/notes.pdf'],
  );
});

test('saveImageUnlessStale deletes a file a clear outdated mid-save and keeps a later one', async () => {
  // Regression for the addBlob/applyCrop submit races: a clear() while the
  // file is still being written must delete it on landing instead of letting
  // it surface (as a chip or an orphaned temp file) on a later prompt.
  const additions = createPendingAdditions();
  const beforeClear = additions.stamp();
  const write = deferred();
  const discarded: string[] = [];
  const discard = async (path: string) => {
    discarded.push(path);
  };
  const saving = saveImageUnlessStale(
    additions,
    beforeClear,
    async () => {
      await write.promise;
      return '/tmp/stale.png';
    },
    discard,
  );
  additions.invalidate(); // clear() while the file is being written
  write.resolve();
  assert.equal(await saving, null);
  assert.deepEqual(discarded, ['/tmp/stale.png']);

  // An addition stamped after the clear is not stale.
  const afterClear = additions.stamp();
  assert.equal(
    await saveImageUnlessStale(additions, afterClear, async () => '/tmp/fresh.png', discard),
    '/tmp/fresh.png',
  );
  assert.deepEqual(discarded, ['/tmp/stale.png']);
});
