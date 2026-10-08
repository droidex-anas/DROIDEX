import assert from 'node:assert/strict';
import test from 'node:test';
import {
  dirtyPaths,
  emptyCanvasSourceState,
  isSaving,
  openFrameSource,
  sourceText,
  saveFailure,
} from './canvasSourceState';
import {
  saveCanvasSource,
  dispatchCanvasSource,
  forgetCanvasSource,
  readCanvasSource,
  subscribeCanvasSource,
} from './canvasSourceStore';
import type { WriteReceipt } from './protocol';

const ENTRY = 'App.tsx';

/** A write the test answers when it chooses, with a receipt or a failure. */
function heldWrite() {
  const unstarted = () => {
    throw new Error('Write not started');
  };
  let commit: (revisionId: string) => void = unstarted;
  let reject: (error: Error) => void = unstarted;
  const promise = new Promise<WriteReceipt>((settle, fail) => {
    commit = (revisionId) => {
      settle({ designId: 'hey', revisionId, sequence: 1 });
    };
    reject = fail;
  });
  return { promise, commit, reject };
}

/** What a mounting panel does: open the frame, then answer its read. */
function mount(canvasId: string, revisionId = 'rev_1'): void {
  dispatchCanvasSource(canvasId, { type: 'openSourcePanel', designId: 'hey' });
  dispatchCanvasSource(canvasId, { type: 'reading', designId: 'hey', revisionId });
  dispatchCanvasSource(canvasId, {
    type: 'loaded',
    designId: 'hey',
    revisionId,
    files: { [ENTRY]: 'const a = 1;\n' },
    diagnostics: [],
  });
}

test('a draft outlives the panel that typed it, and only a deliberate close drops it', () => {
  const canvasId = 'cv_remount';
  mount(canvasId);
  dispatchCanvasSource(canvasId, { type: 'edit', path: ENTRY, text: 'mine\n' });

  // Selecting another utility tab, hiding the pane or visiting Projects unmounts
  // the panel and mounts it again. Nothing about that is a discard.
  mount(canvasId);
  const source = openFrameSource(readCanvasSource(canvasId));
  assert.equal(sourceText(source, ENTRY), 'mine\n');
  assert.deepEqual(dirtyPaths(source), [ENTRY]);

  // Another canvas is another drawer: it neither sees nor loses this draft.
  assert.deepEqual(dirtyPaths(openFrameSource(readCanvasSource('cv_other'))), []);

  forgetCanvasSource(canvasId);
  assert.deepEqual(readCanvasSource(canvasId), emptyCanvasSourceState);
});

test('one keystroke is one write', async () => {
  const canvasId = 'cv_one_write';
  mount(canvasId);
  dispatchCanvasSource(canvasId, { type: 'edit', path: ENTRY, text: 'mine\n' });
  const gate = heldWrite();
  const requests: unknown[] = [];
  const send: Parameters<typeof saveCanvasSource>[2] = (_, write) => {
    requests.push(write);
    return gate.promise;
  };
  const first = saveCanvasSource(canvasId, 'mut_1', send);
  await saveCanvasSource(canvasId, 'mut_2', send);
  assert.deepEqual(requests, [
    {
      mutationId: 'mut_1',
      designId: 'hey',
      expectedRevisionId: 'rev_1',
      files: { [ENTRY]: 'mine\n' },
      deletedPaths: [],
    },
  ]);
  gate.reject(new Error('Connection lost'));
  await first;
});

test('a save with nothing to write is not submitted', async () => {
  const canvasId = 'cv_clean';
  mount(canvasId);
  await saveCanvasSource(canvasId, 'mut_1', () => {
    assert.fail('A clean frame must not submit a write');
  });
});

test('a subscriber hears its own canvas until it unsubscribes', () => {
  const canvasId = 'cv_watch';
  let heard = 0;
  const stop = subscribeCanvasSource(canvasId, () => {
    heard += 1;
  });
  mount(canvasId);
  assert.ok(heard > 0);

  const seen = heard;
  dispatchCanvasSource('cv_elsewhere', { type: 'openSourcePanel', designId: 'hey' });
  assert.equal(heard, seen);

  stop();
  dispatchCanvasSource(canvasId, { type: 'edit', path: ENTRY, text: 'mine\n' });
  assert.equal(heard, seen);
});

test('deliberate close clears all state and a late failure cannot settle the replacement save', async () => {
  const canvasId = 'cv_replacement';
  mount(canvasId);
  dispatchCanvasSource(canvasId, { type: 'edit', path: ENTRY, text: 'old draft' });
  const old = heldWrite();
  const first = saveCanvasSource(canvasId, 'mut_old', () => old.promise);
  forgetCanvasSource(canvasId);
  assert.deepEqual(readCanvasSource(canvasId), emptyCanvasSourceState);
  mount(canvasId);
  dispatchCanvasSource(canvasId, { type: 'edit', path: ENTRY, text: 'replacement draft' });
  const replacement = heldWrite();
  const second = saveCanvasSource(canvasId, 'mut_replacement', () => replacement.promise);
  old.reject(new Error('Old failure'));
  await first;
  const current = readCanvasSource(canvasId);
  assert.equal(isSaving(current), true);
  assert.equal(saveFailure(current), null);
  assert.equal(sourceText(openFrameSource(current), ENTRY), 'replacement draft');
  assert.deepEqual(dirtyPaths(openFrameSource(current)), [ENTRY]);
  replacement.reject(new Error('Replacement failure'));
  await second;
  assert.equal(saveFailure(readCanvasSource(canvasId)), 'Replacement failure');
  forgetCanvasSource(canvasId);
  assert.deepEqual(readCanvasSource(canvasId), emptyCanvasSourceState);
});

test('a receipt for a discarded save cannot settle the replacement that followed it', async () => {
  const canvasId = 'cv_stale_receipt';
  mount(canvasId);
  dispatchCanvasSource(canvasId, { type: 'edit', path: ENTRY, text: 'old draft' });
  const old = heldWrite();
  const first = saveCanvasSource(canvasId, 'mut_old', () => old.promise);

  // Close → Discard while that write is away, then the drawer is opened on the
  // same canvas again and typed into.
  forgetCanvasSource(canvasId);
  mount(canvasId);
  dispatchCanvasSource(canvasId, { type: 'edit', path: ENTRY, text: 'replacement draft' });
  const replacement = heldWrite();
  const second = saveCanvasSource(canvasId, 'mut_replacement', () => replacement.promise);

  // The discarded write did commit. Its receipt is the record of a lifetime the
  // user threw away: settling the replacement with it would clear the draft's
  // dirty marker, disable Save, and let the next head read erase the typing.
  old.commit('rev_old');
  await first;
  const racing = openFrameSource(readCanvasSource(canvasId));
  assert.equal(isSaving(readCanvasSource(canvasId)), true);
  assert.equal(racing.revisionId, 'rev_1');
  assert.equal(sourceText(racing, ENTRY), 'replacement draft');
  assert.deepEqual(dirtyPaths(racing), [ENTRY]);

  // The replacement's own receipt still settles it.
  replacement.commit('rev_2');
  await second;
  const settled = openFrameSource(readCanvasSource(canvasId));
  assert.equal(settled.revisionId, 'rev_2');
  assert.equal(sourceText(settled, ENTRY), 'replacement draft');
  assert.deepEqual(dirtyPaths(settled), []);
  forgetCanvasSource(canvasId);
});
