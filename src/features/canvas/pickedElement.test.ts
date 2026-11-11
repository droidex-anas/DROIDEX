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
  });
  // Where each element is written: in Card, in card.tsx, or in the page's main.
  const inCard = { file: 'card.tsx', start: 20, end: 60, component: 'Card' };
  const inPage = { file: 'main.tsx', start: 40, end: 90, component: null };
  const writtenIn = {
    el_main: inPage,
    el_root: inCard,
    el_title: inCard,
    el_icon: { ...inPage, start: 60, end: 70 },
  };
  const outlined = (...nodes: OutlineNode[]) => ({
    build: {
      ...build,
      elements: Object.entries(writtenIn).map(([elementId, written]) => ({
        ...build.elements[0],
        elementId,
        ...written,
      })),
      outline: { nodes, truncated: false },
    },
  });
  const named = (picked: ReturnType<typeof pickedLayer>) =>
    picked && 'row' in picked ? picked.row.nodeId : picked;
  const page = row('main', null, 'element', 'main', 'el_main');
  const card = outlined(
    page,
    row('card', 'main', 'instance', 'Card'),
    row('icon', 'card', 'element', 'em', 'el_icon'),
    row('root', 'card', 'element', 'section', 'el_root'),
    row('title', 'root', 'element', 'h1', 'el_title'),
  );
  assert.equal(named(pickedLayer(card, 'r2', 'el_title')), 'title');
  assert.equal(named(pickedLayer(card, 'r2', 'el_root')), 'card');
  // JSX passed in Card's icon prop is the page's, so Delete names it, not the Card.
  assert.equal(named(pickedLayer(card, 'r2', 'el_icon')), 'icon');
  assert.equal(pickedLayer(card, 'r1', 'el_title'), undefined);

  // Card imported as C: the prop's JSX is written inside main, so it is still its own
  // row; Card's section is not, and is refused rather than deleted from Card.
  const aliased = outlined(
    page,
    row('card', 'main', 'instance', 'C'),
    row('icon', 'card', 'element', 'em', 'el_icon'),
    row('root', 'card', 'element', 'section', 'el_root'),
  );
  assert.equal(named(pickedLayer(aliased, 'r2', 'el_icon')), 'icon');
  assert.deepEqual(pickedLayer(aliased, 'r2', 'el_root'), {
    refusal:
      'Can’t tell this element from the component that draws it. Delete it from the layers panel.',
  });

  // Each of two Cards draws the section: Delete names a section row, which is
  // refused, never the first Card in place of the one picked.
  const twice = outlined(
    page,
    row('first', 'main', 'instance', 'Card'),
    { ...row('root1', 'first', 'element', 'section', 'el_root'), lock: 'shared' },
    row('second', 'main', 'instance', 'Card'),
    { ...row('root2', 'second', 'element', 'section', 'el_root'), lock: 'shared' },
  );
  const picked = pickedLayer(twice, 'r2', 'el_root');
  assert.equal(picked && 'row' in picked && picked.row.kind, 'element');
});
