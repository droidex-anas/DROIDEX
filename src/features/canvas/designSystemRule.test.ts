import assert from 'node:assert/strict';
import test from 'node:test';
import {
  ADHERENCE_CODES,
  CODE_QUALITY_CODES,
} from '../../../sidecar/src/canvas/canvasDiagnostics.js';
import {
  blockedByStrictRule,
  isAdherenceDiagnostic,
  kitNotes,
  kitNotesLabel,
  kitNotesSummary,
} from './designSystemRule';
import type { CanvasBuildState, CanvasDiagnostic } from './protocol';

function note(index: number): CanvasDiagnostic {
  return {
    code: ADHERENCE_CODES.color,
    message: `#${String(index)}00 is a hard-coded colour.`,
    file: 'main.tsx',
    line: index,
  };
}

const warning: CanvasDiagnostic = { code: 'esbuild_warning', message: 'Unused import.' };

function ready(diagnostics: CanvasDiagnostic[]): CanvasBuildState {
  return {
    status: 'ready',
    revisionId: 'rev_1',
    artifactId: 'art_1',
    elements: [],
    diagnostics,
    generation: 1,
  };
}

test('the renderer reads the sidecar’s kit findings, and nothing else, as kit notes', () => {
  for (const code of Object.values(ADHERENCE_CODES))
    assert.equal(isAdherenceDiagnostic({ code, message: '' }), true, code);
  for (const code of Object.values(CODE_QUALITY_CODES))
    assert.equal(isAdherenceDiagnostic({ code, message: '' }), false, code);
});

test('a frame shows kit notes only for a ready build that carries findings', () => {
  // Guide: the build is ready and carries its findings beside other warnings.
  assert.deepEqual(kitNotes(ready([warning, note(1), note(2)])), [note(1), note(2)]);
  // Off: the sidecar checks nothing, so a ready build carries no findings.
  assert.deepEqual(kitNotes(ready([warning])), []);
  // Strict: the findings failed the build, which the failure note shows instead.
  const failed: CanvasBuildState = {
    status: 'failed',
    revisionId: 'rev_2',
    diagnostics: [note(1)],
    lastWorkingRevisionId: 'rev_1',
    generation: 2,
  };
  assert.deepEqual(kitNotes(failed), []);
  assert.equal(blockedByStrictRule(failed.diagnostics), true);
  assert.equal(blockedByStrictRule([{ code: 'tsx_error', message: 'Unexpected token' }]), false);
  // A build still running has no outcome yet.
  assert.deepEqual(kitNotes({ status: 'building', revisionId: 'rev_3', generation: 3 }), []);
  assert.deepEqual(kitNotes({ status: 'pending', generation: 3 }), []);
});

test('the badge counts the notes and its tooltip names the first three', () => {
  assert.equal(kitNotesLabel([note(1)]), '1 kit note');
  assert.equal(kitNotesLabel([note(1), note(2), note(3)]), '3 kit notes');
  assert.equal(
    kitNotesSummary([1, 2, 3, 4, 5].map(note)),
    [
      '#100 is a hard-coded colour.',
      '#200 is a hard-coded colour.',
      '#300 is a hard-coded colour.',
      '+2 more',
    ].join('\n'),
  );
  assert.equal(kitNotesSummary([note(1)]), '#100 is a hard-coded colour.');
});
