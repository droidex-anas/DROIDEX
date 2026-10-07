import assert from 'node:assert/strict';
import test from 'node:test';
import { dirtyPaths, openFrameSource, sourceText } from './canvasSourceState';
import {
  beginCanvasSave,
  dispatchCanvasSource,
  forgetCanvasSource,
  readCanvasSource,
  subscribeCanvasSource,
} from './canvasSourceStore';

const ENTRY = 'App.tsx';

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
  assert.deepEqual(dirtyPaths(openFrameSource(readCanvasSource(canvasId))), []);
});

test('one keystroke is one write', () => {
  const canvasId = 'cv_one_write';
  mount(canvasId);
  dispatchCanvasSource(canvasId, { type: 'edit', path: ENTRY, text: 'mine\n' });

  // Cmd+S in the editor and Cmd+S on the drawer are the same keystroke reaching
  // two handlers. The second must find the first already in flight.
  const first = beginCanvasSave(canvasId, 'mut_1');
  const second = beginCanvasSave(canvasId, 'mut_2');
  assert.equal(first?.mutationId, 'mut_1');
  assert.equal(second, null);
  assert.deepEqual(first?.files, { [ENTRY]: 'mine\n' });
});

test('a save with nothing to write is not submitted', () => {
  const canvasId = 'cv_clean';
  mount(canvasId);
  assert.equal(beginCanvasSave(canvasId, 'mut_1'), null);
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
