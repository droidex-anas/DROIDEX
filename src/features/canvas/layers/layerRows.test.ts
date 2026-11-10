import assert from 'node:assert/strict';
import test from 'node:test';
import type { CanvasFrame, OutlineNode, SourceOutline } from '../protocol';
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
// The live preview drew the list's items past its tree's cap.
const layers: FrameLayers = {
  outline,
  drawn: new Map([
    ['el_section', '0'],
    ['el_title', '0/0'],
  ]),
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
  // Only a drawn element can be picked or outlined; an instance, a repeat or an undrawn element cannot.
  assert.deepEqual(
    elements.map((row) => row.target),
    [
      { elementId: 'el_section', instancePath: '0' },
      { elementId: 'el_title', instancePath: '0/0' },
      null,
      null,
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

test('an open frame says when its outline is empty or stopped at the cap', () => {
  const frames = [frame('a', 'Pricing page')];
  const notes = (shown: SourceOutline) =>
    layerEntries(frames, () => ({ outline: shown, drawn: new Map() }), new Set(['a']), new Set())
      .filter((row) => row.kind === 'note')
      .map((row) => row.name);
  assert.deepEqual(notes({ nodes: [], truncated: false }), ['No layers']);
  assert.deepEqual(notes({ ...outline, truncated: true }), ['Showing the first 5 layers']);
});
