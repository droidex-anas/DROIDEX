import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import { dismissToast, subscribeToasts, type ToastItem } from '../../lib/toast';
import { CanvasRequestError } from './client';
import { FrameRemovals } from './frameRemovals';
import type { CanvasChange, CanvasFrame, RemoveFramesInput, UndoRemovalInput } from './protocol';

function frame(designId: string): CanvasFrame {
  return {
    designId,
    name: `Design ${designId}`,
    rect: { x: 0, y: 0, width: 400, height: 300 },
    layoutVersion: 1,
    manifestVersion: 1,
    revisionId: 'r1',
    designSystem: { id: 'droidex', version: 1, mode: 'dark' },
    build: { status: 'building', generation: 1 },
  };
}

/** A client whose every answer the test gives by hand. */
function fakeClient() {
  const removes: (RemoveFramesInput & PromiseWithResolvers<string>)[] = [];
  const undos: (UndoRemovalInput & PromiseWithResolvers<CanvasChange>)[] = [];
  const client = {
    removeFrames: (_appSessionId: string, _canvasId: string, input: RemoveFramesInput) => {
      const answer = Promise.withResolvers<string>();
      removes.push({ ...input, ...answer });
      return answer.promise;
    },
    undoRemoval: (_appSessionId: string, _canvasId: string, input: UndoRemovalInput) => {
      const answer = Promise.withResolvers<CanvasChange>();
      undos.push({ ...input, ...answer });
      return answer.promise;
    },
  };
  return { removals: new FrameRemovals(client), removes, undos };
}

let shown: ToastItem[] = [];
const stopWatching = subscribeToasts((toasts) => {
  shown = toasts;
});
afterEach(() => {
  for (const item of shown) dismissToast(item.id);
});
process.on('exit', stopWatching);

test('a frame already being deleted is not sent again', async () => {
  const { removals, removes } = fakeClient();
  const first = removals.remove('chat', 'cv', [frame('a')]);
  const second = removals.remove('chat', 'cv', [frame('a'), frame('b')]);
  assert.equal(await removals.remove('chat', 'cv', [frame('a')]), false);
  assert.deepEqual(
    removes.map((sent) => sent.designIds),
    [['a'], ['b']],
  );

  removes[0].resolve('undo-a');
  removes[1].resolve('undo-b');
  assert.deepEqual([await first, await second], [true, true]);
  assert.deepEqual(
    shown.map((item) => [item.message, item.action?.label]),
    [
      ['Deleted Design a', 'Undo'],
      ['Deleted Design b', 'Undo'],
    ],
  );
});

test('an answer for a canvas that went away offers no Undo', async () => {
  const { removals, removes } = fakeClient();
  const removing = removals.remove('chat', 'cv', [frame('a'), frame('b')]);
  removals.forget('cv');
  removes[0].resolve('undo-ab');
  assert.equal(await removing, false);
  assert.deepEqual(shown, []);
  assert.equal(removals.undoLatest('cv'), false);
});

test('Undo is tried once, and an occupied place is reported plainly', async () => {
  const { removals, removes, undos } = fakeClient();
  const removing = removals.remove('chat', 'cv', [frame('a')]);
  removes[0].resolve('undo-a');
  await removing;

  assert.equal(removals.undoLatest('cv'), true);
  assert.equal(removals.undoLatest('cv'), false);
  assert.equal(undos.length, 1);
  assert.equal(undos[0].undoId, 'undo-a');
  assert.deepEqual(shown, []);

  undos[0].reject(
    new CanvasRequestError('layout_conflict', 'Another frame now occupies that location.'),
  );
  await Promise.resolve();
  await Promise.resolve();
  assert.deepEqual(
    shown.map((item) => [item.variant, item.message]),
    [['error', 'Something now sits where Design a was.']],
  );
});

test('the Undo ends with its toast', async () => {
  const { removals, removes, undos } = fakeClient();
  const removing = removals.remove('chat', 'cv', [frame('a'), frame('b')]);
  removes[0].resolve('undo-ab');
  await removing;
  assert.equal(shown[0].message, 'Deleted 2 frames');

  dismissToast(shown[0].id);
  assert.equal(removals.undoLatest('cv'), false);
  assert.equal(undos.length, 0);
});
