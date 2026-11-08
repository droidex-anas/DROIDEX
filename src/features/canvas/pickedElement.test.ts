import assert from 'node:assert/strict';
import { test } from 'node:test';
import { pickedElement } from './pickedElement';
import type { PreviewFinding } from './previewDocument';
import type { CanvasBuildState } from './protocol';

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
