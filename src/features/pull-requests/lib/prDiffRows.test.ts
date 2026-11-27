import assert from 'node:assert/strict';
import test from 'node:test';

import { buildDiffChunks, DIFF_CHUNK_ROWS } from '../../../lib/diffRows';
import { diffLineAnchorKey, parseUnifiedDiff } from '../../../lib/unifiedDiff';

function largeDiff(): string {
  const lines = ['@@ -1,230 +1,230 @@'];
  for (let line = 1; line <= 230; line += 1) {
    if (line === 101) {
      lines.push('-old line 101', '+new line 101');
    } else {
      lines.push(` line ${String(line)}`);
    }
  }
  return lines.join('\n');
}

function chunkIndexOf(chunks: ReturnType<typeof buildDiffChunks>, rowId: string): number {
  return chunks.findIndex((chunk) => chunk.some((row) => row.id === rowId));
}

test('review rows keep their chunk when notes or folds change the visible row count', () => {
  const parsed = parseUnifiedDiff(largeDiff());
  const editorKey = diffLineAnchorKey('new', 210);
  const noteKey = diffLineAnchorKey('new', 5);
  const editorRowId = `review:${editorKey}`;
  assert.ok(parsed.hunks[0].lines.length > DIFF_CHUNK_ROWS);

  const before = buildDiffChunks({
    hunks: parsed.hunks,
    splitRows: null,
    anchors: new Set([editorKey]),
    expandedFolds: new Set(),
  });
  const editorChunk = chunkIndexOf(before, editorRowId);
  assert.notEqual(editorChunk, -1);

  const withNoteAbove = buildDiffChunks({
    hunks: parsed.hunks,
    splitRows: null,
    anchors: new Set([editorKey, noteKey]),
    expandedFolds: new Set(),
  });
  assert.equal(chunkIndexOf(withNoteAbove, editorRowId), editorChunk);
  assert.notEqual(chunkIndexOf(withNoteAbove, `review:${noteKey}`), -1);

  const fold = before.flat().find((row) => row.kind === 'fold');
  assert.ok(fold?.kind === 'fold');
  const withExpandedFold = buildDiffChunks({
    hunks: parsed.hunks,
    splitRows: null,
    anchors: new Set([editorKey]),
    expandedFolds: new Set([fold.id]),
  });
  assert.equal(chunkIndexOf(withExpandedFold, editorRowId), editorChunk);
});

test('unchanged runs fold with two edge lines and anchors disable folding', () => {
  const parsed = parseUnifiedDiff(
    [
      '@@ -1,14 +1,14 @@',
      ...Array.from({ length: 3 }, (_, index) => ` line ${String(index + 1)}`),
      '-old',
      '+new',
      ...Array.from({ length: 10 }, (_, index) => ` line ${String(index + 5)}`),
    ].join('\n'),
  );
  const chunks = buildDiffChunks({
    hunks: parsed.hunks,
    splitRows: null,
    anchors: undefined,
    expandedFolds: new Set(),
  });
  const rows = chunks[0];
  const foldIndex = rows.findIndex((row) => row.kind === 'fold');
  assert.notEqual(foldIndex, -1);
  const fold = rows[foldIndex];
  assert.ok(fold.kind === 'fold');
  assert.equal(fold.count, 6);
  assert.ok(rows[foldIndex - 1].id.includes(':6:6'));
  assert.ok(rows[foldIndex + 1].id.includes(':13:13'));

  const anchored = buildDiffChunks({
    hunks: parsed.hunks,
    splitRows: null,
    anchors: new Set([diffLineAnchorKey('new', 8)]),
    expandedFolds: new Set(),
  });
  assert.equal(
    anchored[0].some((row) => row.kind === 'fold'),
    false,
  );
});
