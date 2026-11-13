import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import { dismissToast, subscribeToasts, type ToastItem } from '../../lib/toast';
import { BoardHistory, revisionEntry } from './boardHistory';
import { CanvasRequestError } from './client';
import { FrameRemovals } from './frameRemovals';
import type {
  CanvasChange,
  CanvasFrame,
  RemoveFramesInput,
  SwitchRevisionInput,
  UndoRemovalInput,
} from './protocol';

function frame(designId: string): CanvasFrame {
  return {
    designId,
    name: `Design ${designId}`,
    rect: { x: 0, y: 0, width: 400, height: 300 },
    layoutVersion: 1,
    manifestVersion: 1,
    revisionId: 'r1',
    designSystem: { id: 'droidex', version: 1, mode: 'dark' },
    variantOf: null,
    seededRevisionId: null,
    hidden: false,
    build: { status: 'building', generation: 1 },
  };
}

/** Removals on a board's history, over a client whose every answer the test gives by hand. */
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
  const history = new BoardHistory();
  return { removals: new FrameRemovals(client, history), history, removes, undos };
}

/** Lets every settled answer run through the history. */
const settle = () => new Promise((resolve) => setImmediate(resolve));

const restored: CanvasChange = {
  canvasId: 'cv',
  sequence: 3,
  frames: [],
  builds: [],
  removedDesignIds: [],
};

let shown: ToastItem[] = [];
const stopWatching = subscribeToasts((toasts) => {
  shown = toasts;
});
afterEach(() => {
  for (const item of shown) dismissToast(item.id);
});
process.on('exit', stopWatching);

test('a frame already being deleted is not sent again, and only the newest deletion offers Undo', async () => {
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
  // Undo takes the newest step, so the older toast has nothing left to offer.
  assert.deepEqual(
    shown.map((item) => [item.message, item.action?.label]),
    [['Deleted Design b', 'Undo']],
  );
});

test('an answer for a canvas that went away offers no Undo', async () => {
  const { removals, history, removes } = fakeClient();
  const removing = removals.remove('chat', 'cv', [frame('a'), frame('b')]);
  removals.forget('cv');
  history.forget('cv');
  removes[0].resolve('undo-ab');
  assert.equal(await removing, false);
  assert.deepEqual(shown, []);
  assert.equal(history.undo('cv'), false);
});

test('an occupied place is said plainly, and the deletion stays to undo and redo once it is clear', async () => {
  const { removals, history, removes, undos } = fakeClient();
  const removing = removals.remove('chat', 'cv', [frame('a')]);
  removes[0].resolve('undo-a');
  await removing;

  // The toast's Undo is the board's Undo, and one step is taken back once.
  shown[0].action?.run();
  assert.equal(history.undo('cv'), false);
  assert.deepEqual(
    undos.map((sent) => sent.undoId),
    ['undo-a'],
  );
  undos[0].reject(
    new CanvasRequestError('layout_conflict', 'Another frame now occupies that location.'),
  );
  await settle();
  assert.deepEqual(
    shown.map((item) => [item.variant, item.message]),
    [['error', 'Couldn’t undo deleting Design a. Something now sits where Design a was.']],
  );

  assert.equal(history.undo('cv'), true);
  undos[1].resolve(restored);
  await settle();
  assert.equal(history.redo('cv'), true);
  assert.deepEqual(removes[1].designIds, ['a']);
  removes[1].resolve('undo-a2');
  await settle();
  // Redo removed the frame again, so the next Undo brings back that removal.
  assert.equal(history.undo('cv'), true);
  assert.deepEqual(
    undos.map((sent) => sent.undoId),
    ['undo-a', 'undo-a', 'undo-a2'],
  );
});

test('an edit after a deletion is undone first, and ends the toast’s Undo', async () => {
  const { removals, history, removes, undos } = fakeClient();
  const switches: (SwitchRevisionInput & PromiseWithResolvers<unknown>)[] = [];
  const switchRevision = (input: SwitchRevisionInput) => {
    const answer = Promise.withResolvers();
    switches.push({ ...input, ...answer });
    return answer.promise;
  };
  const removing = removals.remove('chat', 'cv', [frame('a'), frame('c')]);
  removes[0].resolve('undo-a');
  await removing;
  assert.equal(shown[0].message, 'Deleted 2 frames');
  history.record('cv', revisionEntry(switchRevision, frame('b'), 'b1', 'b2'));
  assert.deepEqual(shown, []);

  assert.equal(history.undo('cv'), true);
  assert.equal(history.undo('cv'), true);
  assert.deepEqual(
    switches.map((sent) => [sent.designId, sent.revisionId]),
    [['b', 'b1']],
  );
  assert.equal(undos.length, 0);
  switches[0].resolve(undefined);
  await settle();
  assert.deepEqual(
    undos.map((sent) => sent.undoId),
    ['undo-a'],
  );
});
