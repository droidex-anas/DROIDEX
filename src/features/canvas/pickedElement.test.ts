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

test('Delete names the picked element’s row, or the usage of the component whose root it is', () => {
  const row = (
    nodeId: string,
    parentId: string | null,
    kind: OutlineNode['kind'],
    elementId: string | null,
  ) => ({
    nodeId,
    parentId,
    kind,
    name: nodeId,
    text: null,
    elementId,
    lock: null,
    free: true,
  });
  const outlined = {
    designId: 'design',
    build: {
      ...build,
      outline: {
        nodes: [
          row('main', null, 'element', 'el_main'),
          row('card', 'main', 'instance', null),
          row('root', 'card', 'element', 'el_root'),
          row('title', 'root', 'element', 'el_title'),
        ],
        truncated: false,
      },
    },
  };
  assert.equal(pickedLayer(outlined, 'r2', 'el_title')?.nodeId, 'title');
  assert.equal(pickedLayer(outlined, 'r2', 'el_root')?.nodeId, 'card');
  assert.equal(pickedLayer(outlined, 'r1', 'el_title'), undefined);
});
