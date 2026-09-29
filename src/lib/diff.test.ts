import test from 'node:test';
import assert from 'node:assert';
import { extractFileChange } from './diff';

test('apply_patch recovers the path from a "*** Update File" header', () => {
  const patch = [
    '*** Begin Patch',
    '*** Update File: src/components/App.tsx',
    '@@',
    '-const a = 1;',
    '+const a = 2;',
    '*** End Patch',
  ].join('\n');
  const change = extractFileChange('apply_patch', { input: patch });
  assert.ok(change);
  assert.equal(change?.path, 'src/components/App.tsx');
  assert.equal(change?.verb, 'patch');
});

test('apply_patch recovers the path from a unified-diff +++ header', () => {
  const patch = ['--- a/src/x.ts', '+++ b/src/x.ts', '@@', '-old', '+new'].join('\n');
  const change = extractFileChange('apply_patch', { patch });
  assert.equal(change?.path, 'src/x.ts');
});

test('recovers the path from the --- header for a delete-only diff (+++ /dev/null)', () => {
  const patch = ['--- a/src/gone.ts', '+++ /dev/null', '@@', '-old line 1', '-old line 2'].join(
    '\n',
  );
  const change = extractFileChange('apply_patch', { patch });
  assert.equal(change?.path, 'src/gone.ts');
});

test('an explicit path arg still wins over the patch body', () => {
  const patch = ['*** Update File: ignored.ts', '-old', '+new'].join('\n');
  const change = extractFileChange('apply_patch', { file_path: 'real.ts', patch });
  assert.equal(change?.path, 'real.ts');
});

test('falls back to "file" when no path is present anywhere', () => {
  const change = extractFileChange('apply_patch', { patch: '-old\n+new' });
  assert.equal(change?.path, 'file');
});

test('a line inside a hunk is content even when it reads like a header', () => {
  const added = ['@@ -0,0 +1,2 @@', '+++counter;', '+--x;'].join('\n');
  assert.deepEqual(
    extractFileChange('apply_patch', { patch: added })?.ops.map((op) => [op.type, op.text]),
    [
      ['add', '++counter;'],
      ['add', '--x;'],
    ],
  );
  // A replaced line whose old and new text start like file headers.
  const replaced = [
    '--- a/notes.sql',
    '+++ b/notes.sql',
    '@@ -1 +1 @@',
    '--- old text',
    '+++ new text',
    '--- a/other.sql',
    '+++ b/other.sql',
    '@@ -1 +1 @@',
    '-a',
    '+b',
  ].join('\n');
  assert.deepEqual(
    extractFileChange('apply_patch', { patch: replaced })?.ops.map((op) => [op.type, op.text]),
    [
      ['del', '-- old text'],
      ['add', '++ new text'],
      ['del', 'a'],
      ['add', 'b'],
    ],
  );
});

test('the newline that ends a patch adds no empty row', () => {
  const patch = '@@ -1,2 +1,2 @@\n one\n-two\n+three\n';
  assert.deepEqual(
    extractFileChange('apply_patch', { patch })?.ops.map((op) => op.type),
    ['ctx', 'del', 'add'],
  );
});
