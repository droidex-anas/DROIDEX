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

test('string edits extract exact ops and stats through the lazy computation', () => {
  const change = extractFileChange('Edit', {
    file_path: 'a.ts',
    old_string: 'one\ntwo\nthree',
    new_string: 'one\nTWO\nthree\nfour',
  });
  assert.deepEqual(
    change?.ops.map((op) => [op.type, op.text]),
    [
      ['ctx', 'one'],
      ['del', 'two'],
      ['add', 'TWO'],
      ['ctx', 'three'],
      ['add', 'four'],
    ],
  );
  assert.equal(change?.added, 2);
  assert.equal(change?.removed, 1);
  assert.equal(change?.verb, 'edit');
  assert.equal(change?.path, 'a.ts');

  // A missing side diffs as pure deletions or pure additions.
  assert.equal(extractFileChange('Edit', { file_path: 'a.ts', old_string: 'gone' })?.removed, 1);
  assert.equal(extractFileChange('Edit', { file_path: 'a.ts', new_string: 'born' })?.added, 1);

  // Multi-edit concatenates each pair's diff in order.
  const multi = extractFileChange('MultiEdit', {
    file_path: 'a.ts',
    edits: [
      { old_string: 'x', new_string: 'y' },
      { old_string: 'same', new_string: 'same' },
      { old_string: 'p', new_string: 'q' },
    ],
  });
  assert.deepEqual(
    multi?.ops.map((op) => [op.type, op.text]),
    [
      ['del', 'x'],
      ['add', 'y'],
      ['ctx', 'same'],
      ['del', 'p'],
      ['add', 'q'],
    ],
  );
});

test('an edit that changes nothing extracts to nothing', () => {
  // The emptiness decision is structural: it decides whether the call becomes
  // a diff card or a plain tool row, and it must hold without running the LCS.
  assert.equal(
    extractFileChange('Edit', { file_path: 'a.ts', old_string: 'same', new_string: 'same' }),
    null,
    'identical strings',
  );
  assert.equal(
    extractFileChange('Edit', { file_path: 'a.ts', old_string: '', new_string: '' }),
    null,
    'both empty',
  );
  assert.equal(
    extractFileChange('MultiEdit', {
      file_path: 'a.ts',
      edits: [
        { old_string: 'x', new_string: 'x' },
        { old_string: '', new_string: '' },
      ],
    }),
    null,
    'every pair identical',
  );
  assert.equal(extractFileChange('MultiEdit', { file_path: 'a.ts', edits: [] }), null, 'no pairs');
  // Any difference at all — even only whitespace or a trailing newline — is a diff.
  for (const [oldText, newText] of [
    ['same', 'same '],
    ['a\n', 'a'],
    ['', ' '],
  ]) {
    assert.ok(
      extractFileChange('Edit', { file_path: 'a.ts', old_string: oldText, new_string: newText }),
      JSON.stringify([oldText, newText]),
    );
  }
});

test('a create extracts one addition per line, even for empty content', () => {
  const change = extractFileChange('Write', { file_path: 'a.ts', content: 'first\nsecond\n' });
  assert.equal(change?.verb, 'create');
  assert.deepEqual(
    change?.ops.map((op) => [op.type, op.text]),
    [
      ['add', 'first'],
      ['add', 'second'],
      ['add', ''],
    ],
  );
  assert.equal(change?.added, 3);
  assert.equal(change?.removed, 0);
  assert.equal(extractFileChange('Write', { file_path: 'a.ts', content: '' })?.added, 1);
});

test('extraction is cached per tool-args object and the computed diff is memoized', () => {
  const args = { file_path: 'a.ts', old_string: 'x\ny', new_string: 'x\nz' };
  const first = extractFileChange('Edit', args);
  // The feed scans every edit several times per projection and re-projects on
  // every update; the same args object must cost nothing after the first scan.
  assert.equal(extractFileChange('Edit', args), first);
  // Repeated reads share the one computed ops array instead of re-diffing.
  const ops = first?.ops;
  assert.equal(first?.ops, ops);
  // A new args object (a streaming snapshot replaces them) is a new extraction.
  const snapshot = extractFileChange('Edit', { ...args });
  assert.notEqual(snapshot, first);
  assert.deepEqual(snapshot?.ops, first?.ops);
});
