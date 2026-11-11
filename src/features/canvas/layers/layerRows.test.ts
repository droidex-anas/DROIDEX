import assert from 'node:assert/strict';
import test from 'node:test';
import type { PreviewTree } from '../previewDocumentTree';
import type { CanvasFrame, OutlineNode, SourceOutline } from '../protocol';
import { drawnLayers } from './drawnLayers';
import { layerEntries, nodeKey, type FrameLayers } from './layerRows';

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
    build: { status: 'pending', generation: 1 },
  };
}

const node = (
  nodeId: string,
  parentId: string | null,
  row: Partial<OutlineNode> & Pick<OutlineNode, 'kind' | 'name'>,
): OutlineNode => ({
  nodeId,
  parentId,
  text: null,
  elementId: null,
  lock: null,
  free: true,
  ...row,
});

// section > (h1 "Pricing", Repeat > li "Fast"), Footer
const outline: SourceOutline = {
  nodes: [
    node('n1', null, { kind: 'element', name: 'section', elementId: 'el_section' }),
    node('n2', 'n1', { kind: 'element', name: 'h1', text: 'Pricing', elementId: 'el_title' }),
    node('n3', 'n1', { kind: 'repeat', name: 'Repeat' }),
    node('n4', 'n3', {
      kind: 'element',
      name: 'li',
      text: 'Fast',
      elementId: 'el_item',
      lock: 'repeated',
    }),
    node('n5', null, { kind: 'instance', name: 'Footer', lock: 'kit' }),
  ],
  truncated: false,
};
const read = (nodes: [string, string, number][], truncated: boolean): PreviewTree => ({
  nodes: nodes.map(([elementId, instancePath, depth]) => ({
    elementId,
    instancePath,
    tagName: 'div',
    depth,
  })),
  cap: 400,
  truncated,
});
// The live preview drew the list's items past the first page of its tree.
const layers: FrameLayers = {
  outline,
  drawn: drawnLayers(
    outline,
    read(
      [
        ['el_section', '0', 0],
        ['el_title', '0/0', 1],
      ],
      true,
    ),
  ),
  reading: false,
};

test('an open frame lists its source outline under it, nested as written, each row going to its drawn element', () => {
  const frames = [frame('a', 'Pricing page'), frame('b', 'Checkout')];
  const rows = layerEntries(
    frames,
    (id) => (id === 'a' ? layers : null),
    new Set(['a']),
    new Set(),
  );
  assert.deepEqual(
    rows.map((row) => [row.name, row.level, row.kind === 'note' ? null : row.open]),
    [
      ['Pricing page', 1, true],
      ['section', 2, true],
      ['Pricing', 3, null],
      ['Repeat', 3, true],
      ['Fast', 4, null],
      ['Footer', 2, null],
      // A frame that has never built has nothing to open.
      ['Checkout', 1, null],
    ],
  );
  const elements = rows.flatMap((row) => (row.kind === 'element' ? [row] : []));
  assert.equal(elements[3].parentKey, nodeKey('a', 'n3'));
  // aria-posinset and -setsize count siblings, not rows.
  assert.deepEqual(
    elements.map((row) => [row.name, row.position, row.count]),
    [
      ['section', 1, 2],
      ['Pricing', 1, 2],
      ['Repeat', 2, 2],
      ['Fast', 1, 1],
      ['Footer', 2, 2],
    ],
  );
  // Only a drawn element can be picked or outlined; an instance or a repeat has nothing to,
  // and the item past the page read is not known yet.
  assert.deepEqual(
    elements.map((row) => row.drawn),
    [
      { state: 'drawn', node: { elementId: 'el_section', instancePath: '0' } },
      { state: 'drawn', node: { elementId: 'el_title', instancePath: '0/0' } },
      null,
      { state: 'unread' },
      null,
    ],
  );
});

test('a closed row hides what it holds, and a frame that is shut shows none of its layers', () => {
  const frames = [frame('a', 'Pricing page')];
  const closed = new Set([nodeKey('a', 'n1')]);
  const names = (open: ReadonlySet<string>) =>
    layerEntries(frames, () => layers, open, closed).map((row) => row.name);
  assert.deepEqual(names(new Set(['a'])), ['Pricing page', 'section', 'Footer']);
  assert.deepEqual(names(new Set()), ['Pricing page']);
});

test('an element row says when its element is being read, unreadable, absent or past what was read', () => {
  const frames = [frame('a', 'Pricing page')];
  const title = (shown: Omit<FrameLayers, 'outline'>) =>
    layerEntries(frames, () => ({ outline, ...shown }), new Set(['a']), new Set())
      .flatMap((row) => (row.kind === 'element' && row.name === 'Pricing' ? [row.drawn] : []))
      .at(0);
  assert.deepEqual(title({ drawn: null, reading: true }), { state: 'reading' });
  assert.deepEqual(title({ drawn: null, reading: false }), { state: 'unread' });
  const sectionOnly = read([['el_section', '0', 0]], false);
  assert.deepEqual(title({ drawn: drawnLayers(outline, sectionOnly), reading: false }), {
    state: 'absent',
  });
  const stopped = { ...sectionOnly, truncated: true };
  assert.deepEqual(title({ drawn: drawnLayers(outline, stopped), reading: false }), {
    state: 'unread',
  });
  // While the rest is read, what is not read yet is on its way.
  assert.deepEqual(title({ drawn: drawnLayers(outline, stopped), reading: true }), {
    state: 'reading',
  });
});

test('an open frame says when its outline is empty or stopped at its limits, and lists what is drawn but not written', () => {
  const frames = [frame('a', 'Pricing page')];
  const names = (shown: SourceOutline, tree: PreviewTree | null = null) =>
    layerEntries(
      frames,
      () => ({ outline: shown, drawn: tree && drawnLayers(shown, tree), reading: false }),
      new Set(['a']),
      new Set(),
    ).map((row) => [row.name, row.level]);
  assert.deepEqual(names({ nodes: [], truncated: false }), [
    ['Pricing page', 1],
    ['No layers', 2],
  ]);
  // The outline stopped before the footer's aside, which the preview draws: it still gets a row.
  const cut = { nodes: outline.nodes.slice(0, 4), truncated: true };
  const drawn = read(
    [
      ['el_section', '0', 0],
      ['el_aside', '1', 0],
    ],
    false,
  );
  assert.deepEqual(names(cut, drawn), [
    ['Pricing page', 1],
    ['section', 2],
    ['Pricing', 3],
    ['Repeat', 3],
    ['Fast', 4],
    ['div', 2],
    ['Not every layer could be listed', 2],
  ]);
});
