import assert from 'node:assert/strict';
import test from 'node:test';
import type { CanvasFrame, OutlineNode, SourceOutline } from '../protocol';
import { dropLine, isHideable, isMovable, stepPlace } from './layerMoves';
import { layerEntries, type LayerEntry } from './layerRows';

const node = (
  nodeId: string,
  parentId: string | null,
  name: string,
  row: Partial<OutlineNode> = {},
): OutlineNode => ({
  nodeId,
  parentId,
  kind: 'element',
  name,
  text: null,
  elementId: `el_${nodeId}`,
  lock: null,
  free: true,
  contentFromProps: false,
  hidden: false,
  ...row,
});

// main > (h1, section > (p, img), ul > Repeat > li, aside written inside an expression)
const outline: SourceOutline = {
  nodes: [
    node('main', null, 'main', { free: false }),
    node('h1', 'main', 'h1'),
    node('section', 'main', 'section'),
    node('p', 'section', 'p'),
    node('img', 'section', 'img'),
    node('ul', 'main', 'ul'),
    node('repeat', 'ul', 'Repeat', { kind: 'repeat', elementId: null }),
    node('li', 'repeat', 'li', { lock: 'repeated' }),
    node('aside', 'main', 'aside', { free: false }),
  ],
  truncated: false,
};

function rowsOf(build: CanvasFrame['build'], shown = outline): LayerEntry[] {
  const frame: CanvasFrame = {
    designId: 'a',
    name: 'Design A',
    rect: { x: 0, y: 0, width: 400, height: 300 },
    layoutVersion: 1,
    manifestVersion: 1,
    revisionId: 'rev_01',
    designSystem: { id: 'droidex', version: 1, mode: 'dark' },
    variantOf: null,
    seededRevisionId: null,
    hidden: false,
    build,
  };
  const layers = { outline: shown, drawn: null, reading: false };
  return layerEntries([frame], () => layers, new Set(['a']), new Set());
}

const rows = rowsOf({
  status: 'ready',
  generation: 1,
  revisionId: 'rev_01',
  artifactId: 'a'.repeat(64),
  elements: [],
  outline,
  diagnostics: [],
});
const at = (nodeId: string) => rows.findIndex((row) => row.key === `a#${nodeId}`);
const drop = (subject: string, gap: number, level: number) =>
  dropLine(rows, at(subject), gap, level).drop;

test('the rows that move are those written once as a whole child of an element', () => {
  const movable = rows.filter(isMovable).map((row) => row.node.nodeId);
  assert.deepEqual(movable, ['h1', 'section', 'p', 'img', 'ul', 'repeat']);
});

test('the rows that hide are the elements among them, which take the hidden attribute', () => {
  const hideable = rows.filter(isHideable).map((row) => row.node.nodeId);
  assert.deepEqual(hideable, ['h1', 'section', 'p', 'img', 'ul']);
});

test('a drop lands among the children of the row a level out above it, at the level the pointer asks', () => {
  // Below the section and its children, at the section's level, h1 goes before ul.
  assert.deepEqual(dropLine(rows, at('h1'), at('ul'), 3), {
    gap: at('ul'),
    level: 3,
    drop: { state: 'drop', place: { parentId: 'main', beforeId: 'ul' } },
  });
  // A level in, it goes last into the section.
  assert.deepEqual(drop('h1', at('ul'), 4), {
    state: 'drop',
    place: { parentId: 'section', beforeId: null },
  });
  // Further in than the row above allows, the level stops there: img holds nothing.
  assert.deepEqual(dropLine(rows, at('h1'), at('ul'), 9).level, 5);
  assert.deepEqual(drop('h1', at('ul'), 9), {
    state: 'refused',
    reason: 'This layer can’t hold other layers.',
  });
  // Past the frame's last row, the boundary is the end of its layers.
  assert.equal(dropLine(rows, at('p'), 40, 3).gap, rows.length);
});

test('a drop where the layer already is changes nothing, and one it cannot take says why', () => {
  assert.deepEqual(drop('h1', at('h1'), 3), { state: 'still' });
  assert.deepEqual(drop('h1', at('section'), 3), { state: 'still' });
  assert.deepEqual(drop('img', at('img') + 1, 4), { state: 'still' });
  assert.deepEqual(drop('section', at('img'), 4), {
    state: 'refused',
    reason: 'A layer can’t move into itself.',
  });
  // The frame's root has no element around it to take a second one.
  assert.deepEqual(drop('h1', 0, 1), {
    state: 'refused',
    reason: 'A layer can move only inside another layer.',
  });
  assert.deepEqual(drop('h1', at('li'), 5), {
    state: 'refused',
    reason: 'This layer can’t hold other layers.',
  });
  assert.deepEqual(drop('h1', at('aside'), 3), {
    state: 'refused',
    reason: 'A layer can’t go there.',
  });
  // Rows from the build before the one under way name a revision the frame has left.
  const rebuilding = rowsOf({ status: 'building', generation: 2, revisionId: 'rev_02' });
  assert.deepEqual(dropLine(rebuilding, at('h1'), at('ul'), 3).drop, {
    state: 'refused',
    reason: 'Wait until this frame has built.',
  });
  assert.equal(stepPlace(rebuilding, at('h1'), 'down'), null);
});

test('a layer inside text stays in it, and an element with text of its own or content from props takes no other layer', () => {
  const nodes = [
    ...outline.nodes,
    node('note', 'main', 'p', { text: 'Hello' }),
    node('b', 'note', 'b'),
    node('box', 'main', 'div', { contentFromProps: true }),
  ];
  const texts = rowsOf(rows[0].frame.build, { nodes, truncated: false });
  const index = (nodeId: string) => texts.findIndex((row) => row.key === `a#${nodeId}`);
  assert.equal(isMovable(texts[index('b')]), false);
  assert.deepEqual(dropLine(texts, index('h1'), index('b'), 4).drop, {
    state: 'refused',
    reason: 'This layer sits inside text. Edit the text instead.',
  });
  assert.deepEqual(dropLine(texts, index('h1'), texts.length, 4).drop, {
    state: 'refused',
    reason: 'This layer’s props may set its content, so it can’t hold other layers.',
  });
});
test('the keyboard steps a layer past its free siblings, out of its parent, or into the layer above', () => {
  assert.equal(stepPlace(rows, at('h1'), 'up'), null);
  assert.deepEqual(stepPlace(rows, at('h1'), 'down'), { parentId: 'main', beforeId: 'ul' });
  assert.deepEqual(stepPlace(rows, at('ul'), 'up'), { parentId: 'main', beforeId: 'section' });
  // Only a row written as a whole child can stand before another.
  assert.equal(stepPlace(rows, at('ul'), 'down'), null);
  assert.deepEqual(stepPlace(rows, at('p'), 'out'), { parentId: 'main', beforeId: 'ul' });
  assert.equal(stepPlace(rows, at('h1'), 'out'), null);
  assert.deepEqual(stepPlace(rows, at('ul'), 'in'), { parentId: 'section', beforeId: null });
  assert.equal(stepPlace(rows, at('p'), 'in'), null);
  assert.deepEqual(stepPlace(rows, at('section'), 'in'), { parentId: 'h1', beforeId: null });
  // Out of ul and past the aside, which is not a whole child to stand before, to main's end.
  assert.deepEqual(stepPlace(rows, at('repeat'), 'out'), { parentId: 'main', beforeId: null });
  assert.equal(stepPlace(rows, at('li'), 'up'), null);
});
