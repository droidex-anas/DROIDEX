import assert from 'node:assert/strict';
import test from 'node:test';
import type { PreviewTreeNode } from '../previewDocumentTree';
import type { CanvasFrame } from '../protocol';
import { elementKey, layerEntries, type ElementTree } from './layerRows';

function frame(designId: string, name: string): CanvasFrame {
  return {
    designId,
    name,
    rect: { x: 0, y: 0, width: 400, height: 300 },
    layoutVersion: 1,
    manifestVersion: 1,
    revisionId: 'rev_01',
    designSystem: { id: 'droidex', version: 1, mode: 'dark' },
    variantOf: null,
    seededRevisionId: null,
    hidden: false,
    build: {
      status: 'ready',
      revisionId: 'rev_01',
      generation: 1,
      diagnostics: [],
      elements: [
        {
          elementId: 'el_card',
          file: 'main.tsx',
          start: 10,
          end: 90,
          line: 2,
          tagName: 'section',
          component: 'Card',
        },
      ],
    },
  };
}

const node = (elementId: string, tagName: string, instancePath: string, depth: number) =>
  ({ elementId, tagName, instancePath, depth }) satisfies PreviewTreeNode;

// section > (h1, ul > li), p
const nodes = [
  node('el_card', 'section', '0', 0),
  node('el_title', 'h1', '0/0', 1),
  node('el_list', 'ul', '0/1', 1),
  node('el_item', 'li', '0/1/0', 2),
  node('el_foot', 'p', '1', 0),
];
const read = (truncated = false): ElementTree => ({
  state: 'read',
  tree: { nodes, cap: 400, truncated },
  revisionId: 'rev_01',
});

test('an open frame lists its elements under it, nested by depth, named by their component', () => {
  const frames = [frame('a', 'Pricing'), frame('b', 'Checkout')];
  const rows = layerEntries(
    frames,
    (id) => (id === 'a' ? read() : null),
    new Set(['a']),
    new Set(),
  );
  assert.deepEqual(
    rows.map((row) => [row.name, row.level, row.kind === 'note' ? null : row.open]),
    [
      ['Pricing', 1, true],
      ['Card', 2, true],
      ['h1', 3, null],
      ['ul', 3, true],
      ['li', 4, null],
      ['p', 2, null],
      // A frame without a live preview has nothing to open.
      ['Checkout', 1, null],
    ],
  );
  const item = rows[4];
  assert.equal(item.kind, 'element');
  if (item.kind !== 'element') return;
  assert.equal(item.parentKey, elementKey('a', '0/1'));
  // aria-posinset and -setsize count siblings, not rows.
  const places = rows.flatMap((row) =>
    row.kind === 'element' ? [[row.name, row.position, row.count]] : [],
  );
  assert.deepEqual(places, [
    ['Card', 1, 2],
    ['h1', 1, 2],
    ['ul', 2, 2],
    ['li', 1, 1],
    ['p', 2, 2],
  ]);
});

test('a closed element hides what it holds, and a frame that is shut shows none of its elements', () => {
  const frames = [frame('a', 'Pricing')];
  const closed = new Set([elementKey('a', '0')]);
  const names = (open: ReadonlySet<string>) =>
    layerEntries(frames, () => read(), open, closed).map((row) => row.name);
  assert.deepEqual(names(new Set(['a'])), ['Pricing', 'Card', 'p']);
  assert.deepEqual(names(new Set()), ['Pricing']);
});

test('an open frame says when its elements are being read, unreadable, absent or past the cap', () => {
  const frames = [frame('a', 'Pricing')];
  const notes = (tree: ElementTree) =>
    layerEntries(frames, () => tree, new Set(['a']), new Set())
      .filter((row) => row.kind === 'note')
      .map((row) => row.name);
  assert.deepEqual(notes({ state: 'reading' }), ['Reading elements…']);
  assert.deepEqual(notes({ state: 'unread' }), ['Couldn’t read this design’s elements']);
  assert.deepEqual(
    notes({ state: 'read', tree: { nodes: [], cap: 400, truncated: false }, revisionId: 'rev_01' }),
    ['No elements'],
  );
  assert.deepEqual(notes(read(true)), ['Showing the first 400 elements']);
});
