import assert from 'node:assert/strict';
import test from 'node:test';
import type { CatalogListing, OutlineNode } from '../protocol';
import { landingHint, landingOf, paletteRows } from './paletteRows';

const entry = (name: string, module: string | null = null, note: string | null = null) => ({
  name,
  module,
  note,
});

const CATALOG: CatalogListing[] = [
  entry('Alert dialog', 'alert-dialog.tsx'),
  entry('Button', 'button.tsx'),
  entry('Tabs', 'components/ui/tabs.tsx'),
  entry('Data table', 'table.tsx', 'Sortable rows'),
  entry('TabBar'),
  entry('Stable list', null, 'Holds a table of tabs'),
  entry('Lexicon'),
  entry('SVGIcon'),
];

test('a search finds names starting with it first, then words, then names, then files and notes', () => {
  const names = (query: string) => paletteRows(CATALOG, query).map((each) => each.name);
  assert.deepEqual(
    names(''),
    CATALOG.map((each) => each.name),
  );
  assert.deepEqual(names(' tab'), ['Tabs', 'TabBar', 'Data table', 'Stable list']);
  // "Bar" is a word of TabBar; "dialog" one of Alert dialog's.
  assert.deepEqual(names('bar'), ['TabBar']);
  assert.deepEqual(names('DIALOG'), ['Alert dialog']);
  // "Icon" is a word of SVGIcon, so it goes before a name only holding it.
  assert.deepEqual(names('icon'), ['SVGIcon', 'Lexicon']);
  assert.deepEqual(names('sortable'), ['Data table']);
  assert.deepEqual(names('menu'), []);
  // A file matches by its name, not the folder or extension every entry shares.
  assert.deepEqual(names('ui'), []);
  assert.deepEqual(names('tsx'), []);
});

function node(
  nodeId: string,
  parentId: string | null,
  name: string,
  fields: Partial<OutlineNode> = {},
) {
  return {
    nodeId,
    parentId,
    kind: 'element',
    name,
    text: null,
    elementId: `el_${nodeId}`,
    lock: null,
    free: parentId !== null,
    contentFromProps: false,
    ...fields,
  } satisfies OutlineNode;
}

const PAGE = [
  node('main', null, 'main'),
  node('title', 'main', 'h1', { text: 'Pricing' }),
  node('hero', 'main', 'img'),
  node('section', 'main', 'section'),
  node('card', 'section', 'Card', { kind: 'instance', elementId: null }),
  node('p', 'main', 'p', { text: 'Read the ' }),
  node('link', 'p', 'a', { text: 'terms' }),
  node('list', 'main', 'ul'),
  node('item', 'list', 'li', { lock: 'repeated', free: false }),
  node('field', 'main', 'Input', { contentFromProps: true }),
  node('slot', 'section', 'span', { free: false, text: 'Sale' }),
  node('shown', 'main', 'section', { free: false }),
  node('icon', 'main', 'svg'),
  node('path', 'icon', 'path'),
];

test('an entry goes last inside a layer that holds others, else right after it', () => {
  const hint = (nodeId: string, nodes: OutlineNode[] = PAGE) => {
    const at = nodes.find((each) => each.nodeId === nodeId);
    assert.ok(at);
    return landingHint(landingOf(nodes, at));
  };
  assert.equal(hint('main'), 'Adds inside main');
  assert.equal(hint('section'), 'Adds inside section');
  assert.equal(hint('title'), 'Adds after h1');
  assert.equal(hint('hero'), 'Adds after img');
  assert.equal(hint('card'), 'Adds after Card');
  assert.equal(hint('field'), 'Adds after Input');
  assert.equal(
    hint('item'),
    'Written once and repeated for each item. Ask the agent to change it.',
  );
  assert.match(hint('slot'), /^This layer is written inside code/);
  assert.match(hint('shown'), /^This layer is written inside code/);
  assert.equal(hint('link'), 'This layer sits inside text. Pick a layer that holds others.');
  assert.equal(hint('icon'), 'This layer is part of a vector. Pick a layer outside it.');
  assert.equal(hint('path'), 'This layer is part of a vector. Pick a layer outside it.');

  const textTop = [node('top', null, 'h1', { text: 'Hello' })];
  assert.equal(
    hint('top', textTop),
    'This frame’s top layer holds text. Pick a layer that holds others.',
  );
  const imageTop = [node('top', null, 'img')];
  assert.equal(hint('top', imageTop), 'This frame’s top layer can’t hold other layers.');
});
