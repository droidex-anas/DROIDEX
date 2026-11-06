import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import { dismissToast, subscribeToasts, type ToastItem } from '../../lib/toast';
import { BoardHistory, revisionEntry } from './boardHistory';
import { CanvasRequestError } from './client';
import type { SwitchRevisionInput } from './protocol';

const hero = { designId: 'hero', name: 'Hero' };
const card = { designId: 'card', name: 'Card' };

/** A canvas's history over a switch whose every answer the test gives by hand. */
function fakeBoard() {
  const switches: (SwitchRevisionInput & PromiseWithResolvers<unknown>)[] = [];
  const switchRevision = (input: SwitchRevisionInput) => {
    const answer = Promise.withResolvers();
    switches.push({ ...input, ...answer });
    return answer.promise;
  };
  const history = new BoardHistory();
  const edit = (design: typeof hero, before: string, after: string) => {
    history.record('cv', revisionEntry(switchRevision, design, before, after));
  };
  /** Each switch as [design, to, expected head]. */
  const moves = () =>
    switches.map((sent) => [sent.designId, sent.revisionId, sent.expectedRevisionId]);
  return { history, switches, edit, moves };
}

/** Lets every settled answer run through the history. */
const settle = () => new Promise((resolve) => setImmediate(resolve));

let shown: ToastItem[] = [];
const stopWatching = subscribeToasts((toasts) => {
  shown = toasts;
});
afterEach(() => {
  for (const item of shown) dismissToast(item.id);
});
process.on('exit', stopWatching);

test('undo and redo walk one history across designs, a press at a time', async () => {
  const { history, switches, edit, moves } = fakeBoard();
  edit(hero, 'h1', 'h2');
  edit(card, 'c1', 'c2');
  edit(hero, 'h2', 'h3');
  assert.equal(history.undo('cv'), true);
  assert.equal(history.undo('cv'), true);
  assert.equal(history.undo('cv'), true);
  assert.equal(history.undo('cv'), false);
  assert.equal(history.undo('another canvas'), false);
  // Each press waits for the one before, so its switch expects the head that one left.
  assert.deepEqual(moves(), [['hero', 'h2', 'h3']]);
  switches[0].resolve(undefined);
  await settle();
  switches[1].resolve(undefined);
  await settle();
  assert.deepEqual(moves().slice(1), [
    ['card', 'c1', 'c2'],
    ['hero', 'h1', 'h2'],
  ]);
  switches[2].resolve(undefined);
  await settle();

  assert.equal(history.redo('cv'), true);
  switches[3].resolve(undefined);
  await settle();
  assert.deepEqual(moves()[3], ['hero', 'h2', 'h1']);
  // A new step ends what could be redone.
  edit(card, 'c1', 'c4');
  assert.equal(history.redo('cv'), false);
  assert.equal(history.undo('cv'), true);
  assert.deepEqual(moves()[4], ['card', 'c1', 'c4']);
});

test('a design that moved on loses its steps and says so; the other designs keep theirs', async () => {
  const { history, switches, edit, moves } = fakeBoard();
  edit(hero, 'h1', 'h2');
  edit(card, 'c1', 'c2');
  edit(hero, 'h2', 'h3');
  history.undo('cv');
  history.undo('cv');
  switches[0].reject(new CanvasRequestError('revision_conflict', 'The head moved.'));
  await settle();
  assert.deepEqual(
    shown.map((item) => [item.message, item.variant]),
    [['Can’t undo your edit. Hero changed since.', 'error']],
  );
  // The press behind the refused one is dropped rather than run out of order.
  assert.equal(switches.length, 1);

  assert.equal(history.undo('cv'), true);
  assert.deepEqual(moves()[1], ['card', 'c1', 'c2']);
  switches[1].resolve(undefined);
  await settle();
  assert.equal(history.undo('cv'), false);

  // A failure that may pass keeps the step, so the next press tries it again.
  assert.equal(history.redo('cv'), true);
  switches[2].reject(new Error('The socket closed.'));
  await settle();
  assert.match(shown.at(-1)?.message ?? '', /^Couldn’t redo your edit\./);
  assert.equal(history.redo('cv'), true);
  assert.deepEqual(moves().slice(2), [
    ['card', 'c2', 'c1'],
    ['card', 'c2', 'c1'],
  ]);
});
