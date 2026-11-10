import assert from 'node:assert/strict';
import test from 'node:test';
import { MAX_PREVIEW_TREE_NODES, readPreviewTree } from './previewDocumentTree';

const node = (instancePath: string, depth: number) => ({
  elementId: `el_${instancePath}`,
  instancePath,
  tagName: 'div',
  depth,
});

test('a tree answer names each marked element in document order, up to its cap', () => {
  const nodes = [node('0/0', 0), node('0/0/1', 1), node('0/0/1/0', 2), node('0/1', 0)];
  const answer = { nodes, cap: MAX_PREVIEW_TREE_NODES, truncated: false };
  assert.deepEqual(readPreviewTree(JSON.stringify(answer)), answer);

  const full = Array.from({ length: MAX_PREVIEW_TREE_NODES }, (_, index) =>
    node(`0/${String(index)}`, 0),
  );
  const atCap = { nodes: full, cap: MAX_PREVIEW_TREE_NODES, truncated: true };
  assert.deepEqual(readPreviewTree(JSON.stringify(atCap)), atCap);
  // The answer is far larger than the 4096 bytes the other direct answers may measure.
  assert.ok(JSON.stringify(atCap).length > 4096);
});

test('a tree answer that is not one is refused whole', () => {
  const good = { nodes: [node('0/0', 0)], cap: MAX_PREVIEW_TREE_NODES, truncated: false };
  const over = Array.from({ length: MAX_PREVIEW_TREE_NODES + 1 }, () => node('0/0', 0));
  for (const value of [
    null,
    'null',
    'invalid_request',
    { ...good, nodes: over },
    { ...good, cap: 10 },
    { ...good, truncated: 'no' },
    { ...good, nodes: [{ ...node('0/0', 0), elementId: '' }] },
    { ...good, nodes: [{ ...node('0/0', 0), depth: -1 }] },
    { ...good, nodes: [{ ...node('0/0', 0), instancePath: 3 }] },
    // A node sits at most one level below the one before it.
    { ...good, nodes: [node('0/0', 0), node('0/0/0/0', 2)] },
    { ...good, nodes: [node('0/0', 1)] },
    // Past the byte cap, even with every node well formed.
    { ...good, nodes: [{ ...node('0/0', 0), tagName: 'x'.repeat(128 * 1024) }] },
  ]) {
    const answer = typeof value === 'string' || value === null ? value : JSON.stringify(value);
    assert.equal(readPreviewTree(answer), null, String(answer).slice(0, 80));
  }
});
