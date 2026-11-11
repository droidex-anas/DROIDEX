import assert from 'node:assert/strict';
import test from 'node:test';
import { previewShapeScript, readPreviewShape } from './previewDocumentShape';

const rect = { x: 8, y: 8, width: 20, height: 20 };
const drawn = { d: 'M0 0\n  L10,10 Z', matrix: [2, 0, 0, 2, 8, 8], rect };

test('a shape answer is the source path data with a finite matrix and a box, or a known refusal', () => {
  assert.deepEqual(readPreviewShape(JSON.stringify(drawn)), drawn);
  assert.deepEqual(readPreviewShape(JSON.stringify({ refused: 'not_path', d: 'M0 0' })), {
    refused: 'not_path',
  });
  assert.deepEqual(readPreviewShape(JSON.stringify({ refused: 'unreadable' })), {
    refused: 'unreadable',
  });
  // A path at the reporter's cap, with every newline escaped, still reads.
  const long = { ...drawn, d: 'M0 0' + '\n'.repeat(16 * 1024 - 4) };
  assert.equal(readPreviewShape(JSON.stringify(long))?.d.length, 16 * 1024);

  for (const answer of [
    { refused: 'anything' },
    { ...drawn, d: 'M0 0 url(#x)' },
    { ...drawn, d: '<script>' },
    { ...drawn, d: 'M' },
    { ...drawn, d: 'Ee' },
    { ...drawn, d: 'M0 0L' },
    { ...drawn, d: 'M0 0' + ' '.repeat(16 * 1024 - 3) },
    { ...drawn, matrix: [2, 0, 0, 2, 8] },
    { ...drawn, matrix: [2, 0, 0, 2, 8, '8'] },
    { ...drawn, rect: { ...rect, width: -1 } },
    { ...drawn, d: 42 },
  ])
    assert.equal(
      readPreviewShape(JSON.stringify(answer)),
      null,
      JSON.stringify(answer).slice(0, 60),
    );
  assert.equal(readPreviewShape('{'), null);
});

test('a shape is asked for by an element id and path as data', () => {
  assert.equal(
    previewShapeScript({ elementId: '</script>', instancePath: '0/1' }),
    'globalThis.__droidexCanvasPreview.shape({"elementId":"\\u003c/script>","instancePath":"0/1"})',
  );
});
