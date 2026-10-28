import assert from 'node:assert/strict';
import test from 'node:test';
import { searchResultFiles } from './searchResultFiles';

test('glob output is one file per line, in order', () => {
  const files = searchResultFiles(
    ['src/app.tsx', 'src/lib/tools.tsx', '/abs/path/README.md', '.env'].join('\n'),
  );
  assert.deepEqual(files, ['src/app.tsx', 'src/lib/tools.tsx', '/abs/path/README.md', '.env']);
});

test('content output leads each match with path:line, deduped per file', () => {
  const files = searchResultFiles(
    [
      'src/app.ts:12:const density = 1;',
      'src/app.ts:40:  density,',
      'src/lib/tools.ts:3-import { density } from "./x";',
      'docs/rules.md:9:4: space and tone',
    ].join('\n'),
  );
  assert.deepEqual(files, ['src/app.ts', 'src/lib/tools.ts', 'docs/rules.md']);
});

test('count output (path:count) resolves through the plain-path rule', () => {
  assert.deepEqual(searchResultFiles('src/app.ts:3\nsrc/lib/x.ts:12'), [
    'src/app.ts',
    'src/lib/x.ts',
  ]);
});

test('match text without a path prefix is not a file', () => {
  // A single-file grep prints bare `line:content` rows; none may become chips.
  assert.deepEqual(searchResultFiles('12:const x = 1;\n40:  return x;'), []);
});

test('prose, separators and URLs drop out', () => {
  const files = searchResultFiles(
    ['Found 12 matches in 4 files', '--', 'https://example.com/a.ts', 'src/real.ts'].join('\n'),
  );
  assert.deepEqual(files, ['src/real.ts']);
});

test('ANSI styling is stripped before parsing', () => {
  assert.deepEqual(searchResultFiles('\u001b[32msrc/app.ts\u001b[0m:12:match'), ['src/app.ts']);
});

test('windows paths normalize to forward slashes', () => {
  assert.deepEqual(searchResultFiles('C:\\repo\\src\\app.ts:12:match'), ['C:/repo/src/app.ts']);
});

test('parsing stops past the tracked cap', () => {
  const output = Array.from({ length: 150 }, (_, i) => `src/file-${String(i)}.ts`).join('\n');
  const files = searchResultFiles(output);
  assert.equal(files.length, 100);
  assert.equal(files.at(-1), 'src/file-99.ts');
});

test('empty and non-path output yields no files', () => {
  assert.deepEqual(searchResultFiles(''), []);
  assert.deepEqual(searchResultFiles('No matches found'), []);
});
