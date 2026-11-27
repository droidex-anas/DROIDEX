import assert from 'node:assert/strict';
import test from 'node:test';

import type { DiffFile } from '../../../types/vcs';
import { flattenPrFileTree, prFileTreeNodes } from './prFileTree';

function file(path: string): DiffFile {
  return { path, status: 'modified', additions: 1, deletions: 0, binary: false };
}

const files = [
  file('src/index.ts'),
  file('README.md'),
  file('src/app/util.ts'),
  file('src/app/main.ts'),
];

test('prFileTreeNodes nests a sorted hierarchy with directories before files', () => {
  const nodes = prFileTreeNodes(files);
  assert.deepEqual(
    nodes.map((node) => [node.row.kind, node.row.relative]),
    [
      ['directory', 'src'],
      ['file', 'README.md'],
    ],
  );
  const src = nodes[0];
  assert.deepEqual(
    src.children.map((node) => [node.row.kind, node.row.relative, node.row.depth]),
    [
      ['directory', 'src/app', 1],
      ['file', 'src/index.ts', 1],
    ],
  );
  assert.deepEqual(
    src.children[0].children.map((node) => [node.row.kind, node.row.relative, node.row.depth]),
    [
      ['file', 'src/app/main.ts', 2],
      ['file', 'src/app/util.ts', 2],
    ],
  );
});

test('flattenPrFileTree walks depth-first and skips collapsed descendants', () => {
  const nodes = prFileTreeNodes(files);
  const rows = flattenPrFileTree(nodes, new Set());
  assert.deepEqual(
    rows.map((row) => [row.kind, row.relative, row.depth]),
    [
      ['directory', 'src', 0],
      ['directory', 'src/app', 1],
      ['file', 'src/app/main.ts', 2],
      ['file', 'src/app/util.ts', 2],
      ['file', 'src/index.ts', 1],
      ['file', 'README.md', 0],
    ],
  );
  assert.equal(new Set(rows.map((row) => row.key)).size, rows.length);

  assert.deepEqual(
    flattenPrFileTree(nodes, new Set(['src'])).map((row) => row.relative),
    ['src', 'README.md'],
  );
  assert.deepEqual(
    flattenPrFileTree(nodes, new Set(['src/app'])).map((row) => row.relative),
    ['src', 'src/app', 'src/index.ts', 'README.md'],
  );
});
