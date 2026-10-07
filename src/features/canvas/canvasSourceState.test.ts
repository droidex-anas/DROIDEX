import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildDiagnostics,
  canvasSourceReducer,
  conflictPaths,
  dirtyPaths,
  emptyCanvasSourceState,
  issuesByLine,
  openFrameSource,
  pendingWrite,
  placeIssues,
  sourcePaths,
  sourceText,
  unsavedFrameIds,
  type CanvasSourceAction,
  type CanvasSourceState,
} from './canvasSourceState';
import type { CanvasBuildState, CanvasDiagnostic } from './protocol';

const ENTRY = 'App.tsx';
const STYLES = 'styles.css';

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

  const written = pendingWrite(state);
  assert.ok(written);
  const saved = run(
    state,
    { type: 'saving' },
    {
      type: 'saved',
      designId: 'hey',
      revisionId: 'rev_3',
      files: written.files,
    },
  );
  const source = openFrameSource(saved);
  assert.equal(source.revisionId, 'rev_3');
  assert.equal(sourceText(source, ENTRY), 'mine\n');
  assert.deepEqual(dirtyPaths(source), []);
  assert.equal(saved.saving, false);
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
  const written = pendingWrite(editing);
  assert.ok(written);
  const state = run(
    editing,
    { type: 'saving' },
    { type: 'edit', path: ENTRY, text: 'first and more\n' },
    { type: 'saved', designId: 'hey', revisionId: 'rev_2', files: written.files },
  );
  const source = openFrameSource(state);
  assert.equal(sourceText(source, ENTRY), 'first and more\n');
  assert.deepEqual(dirtyPaths(source), [ENTRY]);
  assert.deepEqual(pendingWrite(state), {
    expectedRevisionId: 'rev_2',
    files: { [ENTRY]: 'first and more\n' },
  });
});

test('a refused save keeps the buffer and reports the runtime’s own wording', () => {
  const state = run(
    opened(),
    { type: 'edit', path: ENTRY, text: 'mine\n' },
    { type: 'saving' },
    { type: 'saveFailed', message: 'Another change landed first. Compare and save again.' },
  );
  assert.equal(state.saving, false);
  assert.equal(state.saveError, 'Another change landed first. Compare and save again.');
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

test('closing the panel drops every buffer it was holding', () => {
  const state = run(
    opened(),
    { type: 'edit', path: ENTRY, text: 'mine\n' },
    { type: 'closeSourcePanel' },
  );
  assert.deepEqual(state, emptyCanvasSourceState);
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

// ── Build diagnostics ────────────────────────────────────────────────

const failure: CanvasDiagnostic = {
  code: 'syntax_error',
  message: 'Unexpected token',
  file: ENTRY,
  line: 4,
  column: 12,
};

test('a build that produced nothing yet has no diagnostics to show', () => {
  const building: CanvasBuildState = { status: 'building', revisionId: 'rev_1', generation: 2 };
  assert.deepEqual(buildDiagnostics(building), []);
  assert.deepEqual(buildDiagnostics({ status: 'pending', generation: 0 }), []);
  assert.deepEqual(
    buildDiagnostics({
      status: 'failed',
      revisionId: 'rev_1',
      diagnostics: [failure],
      lastWorkingRevisionId: null,
      generation: 3,
    }),
    [failure],
  );
});

test('diagnostics land on the file and line the build named', () => {
  const issues = placeIssues([failure], [ENTRY, STYLES]);
  assert.deepEqual(issues, [{ diagnostic: failure, path: ENTRY, line: 4 }]);
  assert.deepEqual([...issuesByLine(issues, ENTRY).keys()], [4]);
  assert.equal(issuesByLine(issues, STYLES).size, 0);
});

test('a diagnostic from outside the frame’s own files is left unplaced', () => {
  const kit: CanvasDiagnostic = {
    code: 'unsupported_import',
    message: 'That import is not available.',
    file: '@droidex/design-system/Button.tsx',
    line: 9,
  };
  const nowhere: CanvasDiagnostic = { code: 'build_timeout', message: 'This build was too slow.' };
  assert.deepEqual(placeIssues([kit, nowhere], [ENTRY]), [
    { diagnostic: kit, path: null, line: null },
    { diagnostic: nowhere, path: null, line: null },
  ]);
});

test('a diagnostic with no usable line marks the file but no line', () => {
  const whole: CanvasDiagnostic = { code: 'invalid_source', message: 'Nope', file: ENTRY, line: 0 };
  assert.deepEqual(placeIssues([whole], [ENTRY]), [{ diagnostic: whole, path: ENTRY, line: null }]);
  assert.equal(issuesByLine(placeIssues([whole], [ENTRY]), ENTRY).size, 0);
});
