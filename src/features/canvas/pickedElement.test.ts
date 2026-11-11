import assert from 'node:assert/strict';
import { test } from 'node:test';
import { pickedElement, pickedLayer } from './pickedElement';
import type { PreviewFinding } from './previewDocument';
import type { CanvasBuildState, OutlineNode } from './protocol';

const build: CanvasBuildState = {
  status: 'ready',
  revisionId: 'r2',
  artifactId: 'a'.repeat(64),
  elements: [
    {
      elementId: 'el_1',
      file: 'main.tsx',
      start: 40,
      end: 90,
      line: 3,
      tagName: 'h1',
      component: 'Card',
      editability: 'literal',
    },
  ],
  diagnostics: [],
  generation: 1,
};
const frame = { designId: 'design', build };
const finding: PreviewFinding = {
  elementId: 'el_1',
  instancePath: '0.1',
  rect: { x: 10, y: 20, width: 200, height: 30 },
  text: { excerpt: 'Title', rect: { x: 10, y: 22, width: 48, height: 24 } },
};

test('a probe of the built revision names the element where its source is written', () => {
  assert.deepEqual(pickedElement(frame, 'r2', finding), {
    designId: 'design',
    revisionId: 'r2',
    elementId: 'el_1',
    instancePath: '0.1',
    source: { file: 'main.tsx', start: 40, end: 90, line: 3 },
    tagName: 'h1',
    component: 'Card',
    box: finding.rect,
    text: { excerpt: 'Title', box: { x: 10, y: 22, width: 48, height: 24 } },
  });
});

test('a probe of another revision, or of an element the build does not know, picks nothing', () => {
  assert.equal(pickedElement(frame, 'r1', finding), null);
  assert.equal(pickedElement(frame, 'r2', { ...finding, elementId: 'el_9' }), null);
});

test('Delete names the picked element’s row, or the usage of the component that draws only it', () => {
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
  // Where each element is written: Card's own, or the page's.
  const writtenIn = { el_main: null, el_root: 'Card', el_title: 'Card', el_icon: null };
  const outlined = (...nodes: OutlineNode[]) => ({
    build: {
      ...build,
      elements: Object.entries(writtenIn).map(([elementId, component]) => ({
        ...build.elements[0],
        elementId,
        component,
      })),
      outline: { nodes, truncated: false },
    },
  });
  const page = row('main', null, 'element', 'main', 'el_main');
  const card = outlined(
    page,
    row('card', 'main', 'instance', 'Card'),
    row('icon', 'card', 'element', 'em', 'el_icon'),
    row('root', 'card', 'element', 'section', 'el_root'),
    row('title', 'root', 'element', 'h1', 'el_title'),
  );
  assert.equal(pickedLayer(card, 'r2', 'el_title')?.nodeId, 'title');
  assert.equal(pickedLayer(card, 'r2', 'el_root')?.nodeId, 'card');
  // JSX passed in Card's icon prop is the page's, so Delete names it, not the Card.
  assert.equal(pickedLayer(card, 'r2', 'el_icon')?.nodeId, 'icon');
  assert.equal(pickedLayer(card, 'r1', 'el_title'), undefined);

  // Each of two Cards draws the section: Delete names a section row, which is
  // refused, never the first Card in place of the one picked.
  const twice = outlined(
    page,
    row('first', 'main', 'instance', 'Card'),
    { ...row('root1', 'first', 'element', 'section', 'el_root'), lock: 'shared' },
    row('second', 'main', 'instance', 'Card'),
    { ...row('root2', 'second', 'element', 'section', 'el_root'), lock: 'shared' },
  );
  assert.equal(pickedLayer(twice, 'r2', 'el_root')?.kind, 'element');
});
