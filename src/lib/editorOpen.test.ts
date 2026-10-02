import assert from 'node:assert/strict';
import test from 'node:test';
import { editorLabel, normalizeEditorId } from './editorOpen';

test('known editors keep their id and label; unknown ones fall back to VS Code', () => {
  assert.equal(normalizeEditorId('cursor'), 'cursor');
  assert.equal(normalizeEditorId('unknown'), 'vscode');
  assert.equal(editorLabel('xcode'), 'Xcode');
  assert.equal(editorLabel('bad'), 'VS Code');
});
