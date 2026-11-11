import assert from 'node:assert/strict';
import test from 'node:test';
import { MAX_PREVIEW_TREE_NODES, readPreviewTree, type PreviewTree } from './previewDocumentTree';

const node = (instancePath: string, depth: number) => ({
  elementId: `el_${instancePath}`,
  instancePath,
  tagName: 'div',
  depth,
});
const page = (nodes: ReturnType<typeof node>[], from = 0, truncated = false) =>
  JSON.stringify({ nodes, from, cap: MAX_PREVIEW_TREE_NODES, truncated });

test('a tree answer names each marked element in document order, up to its cap', () => {
  const nodes = [node('0/0', 0), node('0/0/1', 1), node('0/0/1/0', 2), node('0/1', 0)];
  assert.deepEqual(readPreviewTree(page(nodes), null), {
    nodes,
    cap: MAX_PREVIEW_TREE_NODES,
    truncated: false,
  });

  const full = Array.from({ length: MAX_PREVIEW_TREE_NODES }, (_, index) =>
    node(`0/${String(index)}`, 0),
  );
  const atCap = { nodes: full, cap: MAX_PREVIEW_TREE_NODES, truncated: true };
  assert.deepEqual(readPreviewTree(page(full, 0, true), null), atCap);
  // The answer is far larger than the 4096 bytes the other direct answers may measure.
  assert.ok(page(full).length > 4096);
});

test('the next page continues the tree read so far, from where it stopped', () => {
  const first: PreviewTree = {
    nodes: [node('0/0', 0), node('0/0/0', 1)],
    cap: MAX_PREVIEW_TREE_NODES,
    truncated: true,
  };
  const next = [node('0/0/0/0', 2), node('0/1', 0)];
  assert.deepEqual(readPreviewTree(page(next, 2), first), {
    nodes: [...first.nodes, ...next],
    cap: MAX_PREVIEW_TREE_NODES,
    truncated: false,
  });
  // A page for another place in the tree, or one that jumps deeper than the last node read, is refused.
  assert.equal(readPreviewTree(page(next, 0), first), null);
  assert.equal(readPreviewTree(page([node('0/0/0/0/0', 3)], 2), first), null);
});

test('a path is kept whole, so two instances under the same deep wrappers stay apart', () => {
  const wrappers = '0/'.repeat(300);
  const nodes = [0, 1].map((index) => ({
    elementId: 'el_card',
    instancePath: `${wrappers}${String(index)}`,
    tagName: 'div',
    depth: 0,
  }));
  assert.deepEqual(readPreviewTree(page(nodes), null)?.nodes, nodes);
});

test('a tree answer that is not one is refused whole', () => {
  const good = { nodes: [node('0/0', 0)], from: 0, cap: MAX_PREVIEW_TREE_NODES, truncated: false };
  const over = Array.from({ length: MAX_PREVIEW_TREE_NODES + 1 }, () => node('0/0', 0));
  for (const value of [
    null,
    'null',
    'invalid_request',
    { ...good, nodes: over },
    { ...good, cap: 10 },
    { ...good, from: undefined },
    { ...good, truncated: 'no' },
    { ...good, nodes: [{ ...node('0/0', 0), elementId: '' }] },
    { ...good, nodes: [{ ...node('0/0', 0), depth: -1 }] },
    { ...good, nodes: [{ ...node('0/0', 0), instancePath: 3 }] },
    { ...good, nodes: [{ ...node('0/0', 0), instancePath: '0/' }] },
    // A node sits at most one level below the one before it.
    { ...good, nodes: [node('0/0', 0), node('0/0/0/0', 2)] },
    { ...good, nodes: [node('0/0', 1)] },
    // Past the byte cap, even with every node well formed.
    { ...good, nodes: [{ ...node('0/0', 0), tagName: 'x'.repeat(128 * 1024) }] },
  ]) {
    const answer = typeof value === 'string' || value === null ? value : JSON.stringify(value);
    assert.equal(readPreviewTree(answer, null), null, String(answer).slice(0, 80));
  }
});
