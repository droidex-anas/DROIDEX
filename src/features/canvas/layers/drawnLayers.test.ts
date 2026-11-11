import assert from 'node:assert/strict';
import test from 'node:test';
import type { PreviewTree } from '../previewDocumentTree';
import type { OutlineNode, SourceOutline } from '../protocol';
import { drawnLayers } from './drawnLayers';

const row = (
  nodeId: string,
  parentId: string | null,
  kind: OutlineNode['kind'],
  name: string,
  elementId: string | null = null,
): OutlineNode => ({
  nodeId,
  parentId,
  kind,
  name,
  text: null,
  elementId,
  lock: null,
  free: true,
  contentFromProps: false,
  hidden: false,
});

/** The guest's marked elements, each as `instancePath elementId`, indented two spaces a level. */
function tree(lines: string[], truncated = false): PreviewTree {
  const nodes = lines.map((line) => {
    const [instancePath, elementId] = line.trim().split(' ');
    const depth = (line.length - line.trimStart().length) / 2;
    return { elementId, instancePath, tagName: 'div', depth };
  });
  return { nodes, cap: 400, truncated };
}

const states = (layers: ReturnType<typeof drawnLayers>) =>
  Object.fromEntries(
    [...layers.drawn].map(([nodeId, drawn]) => [
      nodeId,
      drawn.state === 'drawn' ? drawn.node.instancePath : drawn.state,
    ]),
  );

// function Card({ show }) { return show ? <p>Visible</p> : null; }
const cards: SourceOutline = {
  nodes: [
    row('i1', null, 'instance', 'Card'),
    row('c1', 'i1', 'condition', 'Condition'),
    row('p1', 'c1', 'element', 'p', 'el_p'),
    row('i2', null, 'instance', 'Card'),
    row('c2', 'i2', 'condition', 'Condition'),
    row('p2', 'c2', 'element', 'p', 'el_p'),
  ],
  truncated: false,
};

test('each instance of a component goes to its own drawn element, and one that cannot be told goes nowhere', () => {
  const both = drawnLayers(cards, tree(['0/0 el_p', '0/1 el_p']));
  assert.deepEqual(states(both), { p1: '0/0', p2: '0/1' });
  assert.deepEqual(
    [...both.rowAt],
    [
      ['0/0', 'p1'],
      ['0/1', 'p2'],
    ],
  );
  // <Card show={false}/><Card show={true}/>: one paragraph drawn for two rows. Neither row may
  // pick it, as either could be the one that rendered, and the board's pick reveals neither.
  const one = drawnLayers(cards, tree(['0/0 el_p']));
  assert.deepEqual(states(one), { p1: 'ambiguous', p2: 'ambiguous' });
  assert.equal(one.rowAt.size, 0);
});

test('a repeat in a component used twice is looked for inside each instance, so each row has its own items', () => {
  // function List({ items }) { return <ul>{items.map((item) => <li>{item}</li>)}</ul>; }
  const lists: SourceOutline = {
    nodes: [
      row('i1', null, 'instance', 'List'),
      row('ul1', 'i1', 'element', 'ul', 'el_ul'),
      row('r1', 'ul1', 'repeat', 'Repeat'),
      row('li1', 'r1', 'element', 'li', 'el_li'),
      row('i2', null, 'instance', 'List'),
      row('ul2', 'i2', 'element', 'ul', 'el_ul'),
      row('r2', 'ul2', 'repeat', 'Repeat'),
      row('li2', 'r2', 'element', 'li', 'el_li'),
    ],
    truncated: false,
  };
  const layers = drawnLayers(
    lists,
    tree(['0/0 el_ul', '  0/0/0 el_li', '  0/0/1 el_li', '0/1 el_ul', '  0/1/0 el_li']),
  );
  assert.deepEqual(states(layers), { ul1: '0/0', ul2: '0/1', li1: '0/0/0', li2: '0/1/0' });
  // Every item a row repeats is that row's on the board.
  assert.equal(layers.rowAt.get('0/0/1'), 'li1');
});

test('a drawn element no row writes gets its own row under the row of the element holding it', () => {
  const outline: SourceOutline = {
    nodes: [row('m', null, 'element', 'main', 'el_main'), row('h', 'm', 'element', 'h1', 'el_h1')],
    truncated: false,
  };
  const layers = drawnLayers(
    outline,
    tree([
      '0 el_main',
      '  0/0 el_x',
      '    0/0/0 el_h1',
      '    0/0/1 el_y',
      '1 el_z',
      '  1/0 el_q',
      '2 el_w',
    ]),
  );
  // Each walk lists the elements it finds in document order.
  assert.deepEqual(
    layers.unwritten.map(({ nodeId, parentId, elementId }) => [nodeId, parentId, elementId]),
    [
      ['@1', null, 'el_z'],
      ['@1/0', '@1', 'el_q'],
      ['@2', null, 'el_w'],
      ['@0/0', 'm', 'el_x'],
      ['@0/0/1', '@0/0', 'el_y'],
    ],
  );
  // The heading is still its own row's, though an element the outline missed holds it.
  assert.deepEqual(states(layers), {
    m: '0',
    h: '0/0/0',
    '@1': '1',
    '@1/0': '1/0',
    '@2': '2',
    '@0/0': '0/0',
    '@0/0/1': '0/0/1',
  });
  assert.equal(layers.rowAt.get('0/0/1'), '@0/0/1');
});

test('a row the walk did not reach is unread, not absent, until a finished walk confirms it', () => {
  const outline: SourceOutline = {
    nodes: [
      row('s1', null, 'element', 'section', 'el_s1'),
      row('a', 's1', 'element', 'p', 'el_a'),
      row('s2', null, 'element', 'section', 'el_s2'),
      row('b', 's2', 'element', 'p', 'el_b'),
    ],
    truncated: false,
  };
  // The walk stopped inside the second section: the first is finished, the second is not.
  const stopped = drawnLayers(outline, tree(['0 el_s1', '1 el_s2'], true));
  assert.deepEqual(states(stopped), { s1: '0', s2: '1', a: 'absent', b: 'unread' });
  // Stopped just after the first section, which may hold more than was read.
  assert.deepEqual(states(drawnLayers(outline, tree(['0 el_s1'], true))), {
    s1: '0',
    a: 'unread',
    s2: 'unread',
    b: 'unread',
  });
  assert.deepEqual(states(drawnLayers(outline, tree(['0 el_s1']))), {
    s1: '0',
    a: 'absent',
    s2: 'absent',
    b: 'absent',
  });
});
