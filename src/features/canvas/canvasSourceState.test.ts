import assert from 'node:assert/strict';
import test from 'node:test';
import {
  canvasSourceReducer,
  conflictPaths,
  dirtyPaths,
  emptyCanvasSourceState,
  isSaving,
  openFrameSource,
  pendingWrite,
  saveFailure,
  sourcePaths,
  sourceText,
  submittedWrite,
  unsavedFrameIds,
  type CanvasSourceAction,
  type CanvasSourceState,
} from './canvasSourceState';

const ENTRY = 'App.tsx';
const STYLES = 'styles.css';
const MUTATION = 'mut_1';

function run(state: CanvasSourceState, ...actions: CanvasSourceAction[]): CanvasSourceState {
  return actions.reduce(canvasSourceReducer, state);
}

/** A panel open on one frame, showing its first revision. */
function opened(files: Record<string, string> = { [ENTRY]: 'const a = 1;\n' }): CanvasSourceState {
  return run(
    emptyCanvasSourceState,
    { type: 'openSourcePanel', designId: 'hey' },
    { type: 'loaded', designId: 'hey', revisionId: 'rev_1', files, diagnostics: [] },
  );
}

test('the first read lists the revision’s files and opens the first one', () => {
  const state = opened({ [STYLES]: 'body {}', [ENTRY]: 'const a = 1;\n' });
  const source = openFrameSource(state);
  assert.deepEqual(sourcePaths(source), [ENTRY, STYLES]);
  assert.equal(source.activePath, ENTRY);
  assert.deepEqual(dirtyPaths(source), []);
  assert.equal(pendingWrite(state), null);
});

test('an edit is dirty, and Save carries the revision it began from', () => {
  const state = run(opened(), { type: 'edit', path: ENTRY, text: 'const a = 2;\n' });
  assert.deepEqual(dirtyPaths(openFrameSource(state)), [ENTRY]);
  assert.deepEqual(pendingWrite(state), {
    expectedRevisionId: 'rev_1',
    files: { [ENTRY]: 'const a = 2;\n' },
  });
});

test('typing the file back to its saved text is not a save', () => {
  const state = run(
    opened(),
    { type: 'edit', path: ENTRY, text: 'changed' },
    { type: 'edit', path: ENTRY, text: 'const a = 1;\n' },
  );
  assert.deepEqual(dirtyPaths(openFrameSource(state)), []);
  assert.equal(pendingWrite(state), null);
});

test('a remote revision replaces a clean panel', () => {
  const state = run(opened(), {
    type: 'loaded',
    designId: 'hey',
    revisionId: 'rev_2',
    files: { [ENTRY]: 'by the agent\n' },
    diagnostics: [],
  });
  const source = openFrameSource(state);
  assert.equal(source.revisionId, 'rev_2');
  assert.equal(sourceText(source, ENTRY), 'by the agent\n');
  assert.deepEqual(dirtyPaths(source), []);
});

test('a remote revision that touched another file only moves the buffer’s base', () => {
  const state = run(
    opened({ [ENTRY]: 'const a = 1;\n', [STYLES]: 'body {}' }),
    { type: 'edit', path: ENTRY, text: 'mine\n' },
    {
      type: 'loaded',
      designId: 'hey',
      revisionId: 'rev_2',
      files: { [ENTRY]: 'const a = 1;\n', [STYLES]: 'body { color: red }' },
      diagnostics: [],
    },
  );
  const source = openFrameSource(state);
  assert.deepEqual(conflictPaths(source), []);
  assert.equal(sourceText(source, ENTRY), 'mine\n');
  // The edit still applies, so Save must name the revision it now sits on or
  // the write would be refused for the change to the other file.
  assert.deepEqual(pendingWrite(state), {
    expectedRevisionId: 'rev_2',
    files: { [ENTRY]: 'mine\n' },
  });
});

test('a remote revision of a dirty file conflicts and keeps both texts', () => {
  const state = run(
    opened(),
    { type: 'edit', path: ENTRY, text: 'mine\n' },
    {
      type: 'loaded',
      designId: 'hey',
      revisionId: 'rev_2',
      files: { [ENTRY]: 'theirs\n' },
      diagnostics: [],
    },
  );
  const source = openFrameSource(state);
  assert.deepEqual(conflictPaths(source), [ENTRY]);
  // Mine is what the editor shows; theirs is the revision behind it.
  assert.equal(sourceText(source, ENTRY), 'mine\n');
  assert.equal(source.files.get(ENTRY), 'theirs\n');
  assert.deepEqual(source.buffers.get(ENTRY)?.conflict, {
    revisionId: 'rev_2',
    text: 'theirs\n',
  });
  // Neither side can be written until the user picks one.
  assert.equal(pendingWrite(state), null);
});

test('Keep mine then Save writes the draft against the revision that superseded it', () => {
  const conflicted = run(
    opened(),
    { type: 'edit', path: ENTRY, text: 'mine\n' },
    {
      type: 'loaded',
      designId: 'hey',
      revisionId: 'rev_2',
      files: { [ENTRY]: 'theirs\n' },
      diagnostics: [],
    },
  );
  const state = run(conflicted, { type: 'keepMine', path: ENTRY });
  assert.deepEqual(conflictPaths(openFrameSource(state)), []);
  assert.deepEqual(pendingWrite(state), {
    expectedRevisionId: 'rev_2',
    files: { [ENTRY]: 'mine\n' },
  });

  const saved = run(
    state,
    { type: 'saving', mutationId: MUTATION },
    { type: 'saved', revisionId: 'rev_3' },
  );
  const source = openFrameSource(saved);
  assert.equal(source.revisionId, 'rev_3');
  assert.equal(sourceText(source, ENTRY), 'mine\n');
  assert.deepEqual(dirtyPaths(source), []);
  assert.equal(isSaving(saved), false);
});

test('Take theirs drops the draft for the revision’s own text', () => {
  const state = run(
    opened(),
    { type: 'edit', path: ENTRY, text: 'mine\n' },
    {
      type: 'loaded',
      designId: 'hey',
      revisionId: 'rev_2',
      files: { [ENTRY]: 'theirs\n' },
      diagnostics: [],
    },
    { type: 'takeTheirs', path: ENTRY },
  );
  const source = openFrameSource(state);
  assert.equal(sourceText(source, ENTRY), 'theirs\n');
  assert.deepEqual(dirtyPaths(source), []);
});

test('a revision that deleted a dirty file conflicts with nothing to take', () => {
  const state = run(
    opened(),
    { type: 'edit', path: ENTRY, text: 'mine\n' },
    { type: 'loaded', designId: 'hey', revisionId: 'rev_2', files: {}, diagnostics: [] },
  );
  const source = openFrameSource(state);
  assert.deepEqual(source.buffers.get(ENTRY)?.conflict, { revisionId: 'rev_2', text: null });
  // The file is still listed, because the user's text for it still exists.
  assert.deepEqual(sourcePaths(source), [ENTRY]);
});

test('text typed while a save is in flight stays dirty on the new revision', () => {
  const editing = run(opened(), { type: 'edit', path: ENTRY, text: 'first\n' });
  const state = run(
    editing,
    { type: 'saving', mutationId: MUTATION },
    { type: 'edit', path: ENTRY, text: 'first and more\n' },
    { type: 'saved', revisionId: 'rev_2' },
  );
  const source = openFrameSource(state);
  assert.equal(sourceText(source, ENTRY), 'first and more\n');
  assert.deepEqual(dirtyPaths(source), [ENTRY]);
  assert.deepEqual(pendingWrite(state), {
    expectedRevisionId: 'rev_2',
    files: { [ENTRY]: 'first and more\n' },
  });
});

test('a save settles without touching a file it never carried', () => {
  const editing = run(opened({ [ENTRY]: 'const a = 1;\n', [STYLES]: 'body {}' }), {
    type: 'edit',
    path: ENTRY,
    text: 'mine\n',
  });
  const state = run(
    editing,
    { type: 'saving', mutationId: MUTATION },
    { type: 'edit', path: STYLES, text: 'body { color: red }' },
    { type: 'saved', revisionId: 'rev_2' },
  );
  const source = openFrameSource(state);
  // The CSS was typed after the write was submitted, so the write never carried
  // it and settling that write cannot be what drops it.
  assert.equal(sourceText(source, STYLES), 'body { color: red }');
  assert.deepEqual(dirtyPaths(source), [STYLES]);
  assert.deepEqual(pendingWrite(state), {
    expectedRevisionId: 'rev_2',
    files: { [STYLES]: 'body { color: red }' },
  });
});

test('a revision that restores the text an edit began from settles its conflict', () => {
  const state = run(
    opened(),
    { type: 'edit', path: ENTRY, text: 'mine\n' },
    {
      type: 'loaded',
      designId: 'hey',
      revisionId: 'rev_2',
      files: { [ENTRY]: 'theirs\n' },
      diagnostics: [],
    },
    {
      type: 'loaded',
      designId: 'hey',
      revisionId: 'rev_3',
      files: { [ENTRY]: 'const a = 1;\n' },
      diagnostics: [],
    },
    { type: 'keepMine', path: ENTRY },
  );
  const source = openFrameSource(state);
  // rev_3 put the file back to what the edit began from, so there is nothing
  // left to compare and Save must name the revision the panel now holds.
  assert.deepEqual(conflictPaths(source), []);
  assert.equal(source.revisionId, 'rev_3');
  assert.deepEqual(pendingWrite(state), {
    expectedRevisionId: 'rev_3',
    files: { [ENTRY]: 'mine\n' },
  });
});

test('a refused save keeps the buffer and reports the runtime’s own wording', () => {
  const state = run(
    opened(),
    { type: 'edit', path: ENTRY, text: 'mine\n' },
    { type: 'saving', mutationId: MUTATION },
    { type: 'saveFailed', message: 'Another change landed first. Compare and save again.' },
  );
  assert.equal(isSaving(state), false);
  assert.equal(saveFailure(state), 'Another change landed first. Compare and save again.');
  assert.equal(sourceText(openFrameSource(state), ENTRY), 'mine\n');
});

test('a read for a frame the panel is not showing still reaches that frame', () => {
  const state = run(
    opened(),
    { type: 'edit', path: ENTRY, text: 'mine\n' },
    { type: 'openSourcePanel', designId: 'cards' },
    {
      type: 'loaded',
      designId: 'cards',
      revisionId: 'rev_7',
      files: { [ENTRY]: 'cards' },
      diagnostics: [],
    },
  );
  assert.equal(openFrameSource(state).revisionId, 'rev_7');
  // Switching frames never drops the other frame's unsaved work.
  assert.deepEqual(unsavedFrameIds(state), ['hey']);
  const back = run(state, { type: 'openSourcePanel', designId: 'hey' });
  assert.equal(sourceText(openFrameSource(back), ENTRY), 'mine\n');
});

test('Revert shows the file as the revision has it', () => {
  const state = run(
    opened(),
    { type: 'edit', path: ENTRY, text: 'mine\n' },
    { type: 'revert', path: ENTRY },
  );
  assert.equal(sourceText(openFrameSource(state), ENTRY), 'const a = 1;\n');
  assert.deepEqual(dirtyPaths(openFrameSource(state)), []);
});

test('an uncertain save keeps its identity, and a changed one gets its own', () => {
  const editing = run(opened(), { type: 'edit', path: ENTRY, text: 'mine\n' });
  const lost = run(
    editing,
    { type: 'saving', mutationId: MUTATION },
    { type: 'saveFailed', message: 'That save did not reach the runtime. Try again.' },
  );
  // The write is still held, so the retry is the same write: only a matching
  // mutation reaches the sidecar's receipt for a save whose reply was lost.
  const retried = run(lost, { type: 'saving', mutationId: 'mut_2' });
  assert.deepEqual(submittedWrite(retried), {
    mutationId: MUTATION,
    designId: 'hey',
    expectedRevisionId: 'rev_1',
    files: { [ENTRY]: 'mine\n' },
    deletedPaths: [],
  });

  // Typing again makes it a different save, which must not claim that receipt.
  const changed = run(
    lost,
    { type: 'edit', path: ENTRY, text: 'mine again\n' },
    {
      type: 'saving',
      mutationId: 'mut_3',
    },
  );
  assert.equal(submittedWrite(changed)?.mutationId, 'mut_3');
});

test('a conflict offers both texts and reapplying is still a CAS save', () => {
  const state = run(
    opened(),
    { type: 'edit', path: ENTRY, text: 'mine\n' },
    {
      type: 'loaded',
      designId: 'hey',
      revisionId: 'rev_2',
      files: { [ENTRY]: 'theirs\n' },
      diagnostics: [],
    },
  );
  const source = openFrameSource(state);
  // Both versions are there to inspect, and inspecting one cannot move the other.
  assert.equal(sourceText(source, ENTRY), 'mine\n');
  assert.equal(source.buffers.get(ENTRY)?.conflict?.text, 'theirs\n');
  assert.equal(pendingWrite(state), null);

  const reapplied = run(state, { type: 'keepMine', path: ENTRY });
  assert.deepEqual(pendingWrite(reapplied), {
    expectedRevisionId: 'rev_2',
    files: { [ENTRY]: 'mine\n' },
  });
});

test('a failed read is reported for its own revision and retried without a loss', () => {
  const state = run(
    opened(),
    { type: 'edit', path: ENTRY, text: 'mine\n' },
    { type: 'reading', designId: 'hey', revisionId: 'rev_2' },
    {
      type: 'readFailed',
      designId: 'hey',
      revisionId: 'rev_2',
      message: 'Canvas is not available.',
    },
  );
  const failed = openFrameSource(state);
  assert.deepEqual(failed.read, {
    status: 'failed',
    revisionId: 'rev_2',
    message: 'Canvas is not available.',
  });
  // The draft is the state nothing else holds a copy of; a failed read is not
  // allowed to be the reason the user has to go and fetch it again.
  assert.equal(sourceText(failed, ENTRY), 'mine\n');
  assert.equal(failed.revisionId, 'rev_1');

  const retrying = openFrameSource(run(state, { type: 'retryRead' }));
  assert.deepEqual(retrying.read, { status: 'loading', revisionId: 'rev_2' });
  assert.equal(retrying.readAttempt, failed.readAttempt + 1);
  assert.equal(sourceText(retrying, ENTRY), 'mine\n');

  // The retry answers, and the dirty buffer conflicts instead of vanishing.
  const loaded = openFrameSource(
    run(
      state,
      { type: 'retryRead' },
      {
        type: 'loaded',
        designId: 'hey',
        revisionId: 'rev_2',
        files: { [ENTRY]: 'theirs\n' },
        diagnostics: [],
      },
    ),
  );
  assert.equal(loaded.read, null);
  assert.deepEqual(conflictPaths(loaded), [ENTRY]);
  assert.equal(sourceText(loaded, ENTRY), 'mine\n');
});

test('a stale read answer cannot report a failure for the revision now shown', () => {
  const state = run(
    opened(),
    { type: 'reading', designId: 'hey', revisionId: 'rev_2' },
    {
      type: 'loaded',
      designId: 'hey',
      revisionId: 'rev_2',
      files: { [ENTRY]: 'theirs\n' },
      diagnostics: [],
    },
    { type: 'readFailed', designId: 'hey', revisionId: 'rev_1', message: 'Too late.' },
  );
  assert.equal(openFrameSource(state).read, null);
});
