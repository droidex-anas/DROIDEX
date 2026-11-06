import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import { dismissToast, subscribeToasts, type ToastItem } from '../../lib/toast';
import { BoardHistory, recordPlacements, revisionEntry } from './boardHistory';
import { CanvasRequestError } from './client';
import type { ArrangeFramesInput, CanvasFrame, SwitchRevisionInput } from './protocol';

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

test('a step recorded while a press runs stays on top of it, and a refused press keeps it', async () => {
  const redoing = fakeBoard();
  redoing.edit(hero, 'h1', 'h2');
  redoing.history.undo('cv');
  redoing.switches[0].resolve(undefined);
  await settle();
  redoing.history.redo('cv');
  redoing.edit(card, 'c1', 'c2');
  redoing.switches[1].resolve(undefined);
  await settle();
  redoing.history.undo('cv');
  assert.deepEqual(redoing.moves()[2], ['card', 'c1', 'c2']);

  // Hero changed while its undo ran; the newer edit is the one left to undo.
  const { history, switches, edit, moves } = fakeBoard();
  edit(hero, 'h1', 'h2');
  history.undo('cv');
  edit(hero, 'h2', 'h3');
  switches[0].reject(new CanvasRequestError('revision_conflict', 'The head moved.'));
  await settle();
  assert.equal(history.undo('cv'), true);
  assert.deepEqual(moves()[1], ['hero', 'h2', 'h3']);
});

test('a deleted canvas runs none of the presses still waiting', async () => {
  const { history, switches, edit } = fakeBoard();
  edit(hero, 'h1', 'h2');
  edit(card, 'c1', 'c2');
  history.undo('cv');
  history.undo('cv');
  history.forget('cv');
  switches[0].resolve(undefined);
  await settle();
  assert.equal(switches.length, 1);
  assert.deepEqual(shown, []);
});

function frame(designId: string, name: string, y: number): CanvasFrame {
  return {
    designId,
    name,
    rect: { x: 0, y, width: 400, height: 300 },
    layoutVersion: 1,
    manifestVersion: 1,
    revisionId: 'r1',
    designSystem: { id: 'droidex', version: 1, mode: 'dark' },
    variantOf: null,
    seededRevisionId: null,
    build: { status: 'building', generation: 1 },
  };
}

/** Two frames placed through the board's history, over an arrange the test answers by hand. */
function fakeLayout() {
  let frames = [frame('hero', 'Hero', 0), frame('card', 'Card', 400)];
  const arranges: (ArrangeFramesInput & PromiseWithResolvers<unknown>)[] = [];
  const history = new BoardHistory();
  const place = recordPlacements(
    history,
    'cv',
    (input: ArrangeFramesInput) => {
      const answer = Promise.withResolvers();
      arranges.push({ ...input, ...answer });
      return answer.promise;
    },
    () => frames,
  );
  /** Lands one arrange as the sidecar does: its frames move, each a layout version on. */
  const land = (index: number) => {
    for (const { designId, rect } of arranges[index].frames)
      frames = frames.map((each) =>
        each.designId === designId
          ? { ...each, rect, layoutVersion: each.layoutVersion + 1 }
          : each,
      );
    arranges[index].resolve(undefined);
  };
  /** Each arrange as `designId y@expected version`. */
  const sent = (index: number) =>
    arranges[index].frames.map(
      (each) => `${each.designId} ${String(each.rect.y)}@${String(each.expectedLayoutVersion)}`,
    );
  const moveElsewhere = (designId: string) => {
    frames = frames.map((each) =>
      each.designId === designId
        ? { ...each, rect: { ...each.rect, x: 900 }, layoutVersion: each.layoutVersion + 1 }
        : each,
    );
  };
  return { history, place, arranges, land, sent, moveElsewhere };
}

test('a placement of two frames undoes and redoes as one step, while they sit where it left them', async () => {
  const { history, place, arranges, land, sent, moveElsewhere } = fakeLayout();
  const moving = place({
    mutationId: 'drag',
    frames: [
      {
        designId: 'hero',
        expectedLayoutVersion: 1,
        rect: { x: 0, y: 50, width: 400, height: 300 },
      },
      {
        designId: 'card',
        expectedLayoutVersion: 1,
        rect: { x: 0, y: 450, width: 400, height: 300 },
      },
    ],
  });
  // Only a placement that lands is a step.
  assert.equal(history.undo('cv'), false);
  land(0);
  await moving;

  assert.equal(history.undo('cv'), true);
  assert.deepEqual(sent(1), ['hero 0@2', 'card 400@2']);
  land(1);
  await settle();
  assert.equal(history.undo('cv'), false);

  assert.equal(history.redo('cv'), true);
  assert.deepEqual(sent(2), ['hero 50@3', 'card 450@3']);
  land(2);
  await settle();

  // A frame moved since is not pulled back, and the step goes.
  moveElsewhere('card');
  assert.equal(history.undo('cv'), true);
  await settle();
  assert.equal(arranges.length, 3);
  assert.deepEqual(
    shown.map((item) => item.message),
    ['Can’t undo moving 2 frames. Hero and Card changed since.'],
  );
  assert.equal(history.undo('cv'), false);
});

test('a press while a placement is on its way is ignored, so it never takes back the step under it', async () => {
  const { history, place, arranges, land, sent } = fakeLayout();
  const moveHero = (y: number, expectedLayoutVersion: number) =>
    place({
      mutationId: `to ${String(y)}`,
      frames: [
        { designId: 'hero', expectedLayoutVersion, rect: { x: 0, y, width: 400, height: 300 } },
      ],
    });
  const first = moveHero(50, 1);
  land(0);
  await first;
  const second = moveHero(60, 2);
  assert.equal(history.undo('cv'), false);
  assert.equal(arranges.length, 2);
  land(1);
  await second;

  assert.equal(history.undo('cv'), true);
  assert.deepEqual(sent(2), ['hero 50@3']);
  land(2);
  await settle();
  assert.equal(history.redo('cv'), true);
  assert.deepEqual(sent(3), ['hero 60@4']);
});
