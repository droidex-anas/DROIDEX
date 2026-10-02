import test from 'node:test';
import assert from 'node:assert';
import { extractFileChange } from './diff';

test('apply_patch recovers the edited path from the patch headers', () => {
  const lines = (...parts: string[]) => parts.join('\n');
  // [why, tool args, expected path]
  const cases: Array<[string, Record<string, string>, string]> = [
    [
      '"*** Update File" header',
      {
        input: lines(
          '*** Begin Patch',
          '*** Update File: src/components/App.tsx',
          '@@',
          '-a',
          '+b',
          '*** End Patch',
        ),
      },
      'src/components/App.tsx',
    ],
    [
      'unified-diff +++ header',
      { patch: lines('--- a/src/x.ts', '+++ b/src/x.ts', '@@', '-old', '+new') },
      'src/x.ts',
    ],
    [
      '--- header of a delete-only diff (+++ /dev/null)',
      { patch: lines('--- a/src/gone.ts', '+++ /dev/null', '@@', '-old line 1', '-old line 2') },
      'src/gone.ts',
    ],
    [
      'an explicit path arg wins over the patch body',
      { file_path: 'real.ts', patch: lines('*** Update File: ignored.ts', '-old', '+new') },
      'real.ts',
    ],
    ['no path anywhere falls back to "file"', { patch: '-old\n+new' }, 'file'],
  ];
  for (const [why, args, path] of cases) {
    assert.equal(extractFileChange('apply_patch', args)?.path, path, why);
  }
  const updated = extractFileChange('apply_patch', cases[0][1]);
  assert.equal(updated?.verb, 'patch');
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
