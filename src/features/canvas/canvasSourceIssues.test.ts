import assert from 'node:assert/strict';
import test from 'node:test';
import { buildDiagnostics, issuesByLine, placeIssues } from './canvasSourceIssues';
import type { CanvasBuildState, CanvasDiagnostic } from './protocol';

const ENTRY = 'App.tsx';
const STYLES = 'styles.css';

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
