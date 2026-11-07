import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import { dismissToast, subscribeToasts, type ToastItem } from '../../lib/toast';
import { BoardHistory } from './boardHistory';
import { CanvasRequestError } from './client';
import type {
  CanvasFrame,
  CanvasSnapshot,
  SourceFiles,
  SwitchRevisionInput,
  WriteFilesInput,
  WriteReceipt,
} from './protocol';
import { variantSetSource, VariantSets } from './variantSets';

function frame(designId: string, variantOf: string | null = null): CanvasFrame {
  return {
    designId,
    name: `Design ${designId}`,
    rect: { x: 0, y: 0, width: 400, height: 300 },
    layoutVersion: 1,
    manifestVersion: 1,
    revisionId: `${designId}1`,
    designSystem: { id: 'droidex', version: 1, mode: 'dark' },
    variantOf,
    seededRevisionId: variantOf === null ? null : `${designId}0`,
    build: {
      status: 'ready',
      generation: 1,
      revisionId: `${designId}1`,
      artifactId: 'a'.repeat(64),
      elements: [],
      diagnostics: [],
    },
  };
}

const source = frame('a');
const chosen = {
  ...frame('b', 'a'),
  designSystem: { id: 'kit', version: 3, mode: 'light' },
} as const;
const board = [source, chosen, frame('c', 'a'), frame('d', 'x')];
const files: Record<string, SourceFiles> = {
  b1: { 'main.tsx': 'variant', 'card.tsx': 'card' },
  a1: { 'main.tsx': 'source', 'old.css': 'old' },
};

/** Variant sets on a board's history, over a client whose writes and switches the test answers. */
function fakeSets() {
  const writes: (WriteFilesInput & PromiseWithResolvers<WriteReceipt>)[] = [];
  const switches: (SwitchRevisionInput & PromiseWithResolvers<WriteReceipt>)[] = [];
  const removed: string[][] = [];
  const snapshot: CanvasSnapshot = {
    canvasId: 'cv',
    sequence: 1,
    frames: board,
    annotationsVersion: 0,
    annotations: [],
  };
  const client = {
    source: {
      read: (_canvasId: string, _designId: string, revisionId: string) =>
        Promise.resolve(files[revisionId]),
      write: (_appSessionId: string, _canvasId: string, input: WriteFilesInput) => {
        const answer = Promise.withResolvers<WriteReceipt>();
        writes.push({ ...input, ...answer });
        return answer.promise;
      },
    },
    revisions: {
      switchTo: (_appSessionId: string, _canvasId: string, input: SwitchRevisionInput) => {
        const answer = Promise.withResolvers<WriteReceipt>();
        switches.push({ ...input, ...answer });
        return answer.promise;
      },
    },
    snapshotOf: () => snapshot,
  };
  const removals = {
    remove: (_appSessionId: string, _canvasId: string, frames: CanvasFrame[]) => {
      removed.push(frames.map((each) => each.designId));
      return Promise.resolve(true);
    },
  };
  const history = new BoardHistory();
  return { sets: new VariantSets(client, history, removals), history, writes, switches, removed };
}

/** Lets every settled answer run through the history. */
const settle = () => new Promise((resolve) => setImmediate(resolve));
const receipt = (revisionId: string): WriteReceipt => ({ designId: 'a', revisionId, sequence: 2 });

let shown: ToastItem[] = [];
const stopWatching = subscribeToasts((toasts) => {
  shown = toasts;
});
afterEach(() => {
  for (const item of shown) dismissToast(item.id);
});
process.on('exit', stopWatching);

test('a variant offers itself to its source once a working build shows its own work and the source is on the board', () => {
  assert.equal(variantSetSource(board, chosen), source);
  assert.equal(variantSetSource(board, source), null);
  assert.equal(variantSetSource(board, frame('d', 'x')), null);
  const building = { ...chosen, build: { status: 'building', revisionId: 'b2', generation: 2 } };
  assert.equal(variantSetSource(board, building as CanvasFrame), null);
  // Still the copy it was made as, or a head whose build has not caught up.
  assert.equal(variantSetSource(board, { ...chosen, seededRevisionId: 'b1' }), null);
  assert.equal(variantSetSource(board, { ...chosen, revisionId: 'b2' }), null);
});

test('using a variant writes its source over the head the user saw, as one step Undo takes back', async () => {
  const { sets, history, writes, switches } = fakeSets();
  const using = sets.apply('chat', 'cv', chosen, source);
  await settle();
  // Its files replace the source's whole tree, and the source takes its design system.
  assert.deepEqual(
    writes.map(({ designId, expectedRevisionId, files: sent, deletedPaths, designSystem }) => ({
      designId,
      expectedRevisionId,
      sent,
      deletedPaths,
      designSystem,
    })),
    [
      {
        designId: 'a',
        expectedRevisionId: 'a1',
        sent: files.b1,
        deletedPaths: ['old.css'],
        designSystem: chosen.designSystem,
      },
    ],
  );
  // A second press while it is written writes nothing more.
  assert.equal(sets.viewOf('cv').of('a'), 'using');
  assert.equal(await sets.apply('chat', 'cv', chosen, source), false);
  assert.equal(history.undo('cv'), false);
  writes[0].resolve(receipt('a2'));
  assert.equal(await using, true);
  assert.equal(sets.viewOf('cv').of('a'), null);
  assert.deepEqual(
    shown.map((item) => [item.message, item.action?.label]),
    [['Design a now uses Design b', 'Remove variants']],
  );

  assert.equal(history.undo('cv'), true);
  assert.deepEqual(
    switches.map((sent) => [sent.designId, sent.revisionId, sent.expectedRevisionId]),
    [['a', 'a1', 'a2']],
  );
  switches[0].resolve(receipt('a1'));
  await settle();
  // Taken back, the choice no longer offers to clear its set; Redo makes it again.
  assert.deepEqual(shown, []);
  assert.equal(history.redo('cv'), true);
  assert.deepEqual(
    switches.map((sent) => [sent.revisionId, sent.expectedRevisionId]),
    [
      ['a1', 'a2'],
      ['a2', 'a1'],
    ],
  );
  switches[1].resolve(receipt('a2'));
  await settle();
  assert.deepEqual(
    shown.map((item) => item.action?.label),
    ['Remove variants'],
  );
});

test('Remove variants deletes the set as the board holds it, the variant used too', async () => {
  const { sets, writes, removed } = fakeSets();
  const using = sets.apply('chat', 'cv', chosen, source);
  await settle();
  writes[0].resolve(receipt('a2'));
  await using;
  shown[0].action?.run();
  assert.deepEqual(removed, [['b', 'c']]);
});

test('a source that moved on since is said plainly, and nothing is recorded', async () => {
  const { sets, history, writes } = fakeSets();
  const using = sets.apply('chat', 'cv', chosen, source);
  await settle();
  writes[0].reject(new CanvasRequestError('revision_conflict', 'That frame has a newer revision.'));
  assert.equal(await using, false);
  assert.deepEqual(
    shown.map((item) => [item.variant, item.message]),
    [['error', 'Couldn’t use Design b. Design a changed since. Try again.']],
  );
  assert.equal(history.undo('cv'), false);
});

test('a write answered after its canvas was deleted records nothing and offers nothing', async () => {
  const { sets, history, writes } = fakeSets();
  const using = sets.apply('chat', 'cv', chosen, source);
  await settle();
  sets.forget('cv');
  history.forget('cv');
  writes[0].resolve(receipt('a2'));
  assert.equal(await using, false);
  assert.deepEqual(shown, []);
  assert.equal(history.undo('cv'), false);
});

test('a source takes one piece of variant work at a time, so two sets cannot share numbers', async () => {
  const { sets, writes } = fakeSets();
  const work = sets.viewOf('cv');
  let told = 0;
  const stop = work.subscribe(() => {
    told += 1;
  });
  const requests: string[] = [];
  const first = Promise.withResolvers<void>();
  const making = sets.make('cv', 'a', () => {
    requests.push('first');
    return first.promise;
  });
  await sets.make('cv', 'a', () => {
    requests.push('second');
    return Promise.resolve();
  });
  assert.equal(await sets.apply('chat', 'cv', chosen, source), false);
  assert.deepEqual(requests, ['first']);
  assert.deepEqual(writes, []);
  assert.deepEqual(
    [work.of('a'), work.of('b'), sets.viewOf('other').of('a')],
    ['making', null, null],
  );

  first.resolve();
  await making;
  assert.equal(work.of('a'), null);
  assert.equal(told, 2);
  stop();
});
