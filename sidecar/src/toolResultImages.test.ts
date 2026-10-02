import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { toolResultParts } from './toolResultImages.js';

const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]).toString('base64');

test('a picture in a tool result becomes a saved file, never text', () => {
  const { text, images } = toolResultParts([
    { type: 'text', text: 'Screenshot of the viewport.' },
    { type: 'image', data: JPEG, mimeType: 'image/jpeg' },
  ]);
  assert.equal(text, 'Screenshot of the viewport.');
  assert.equal(images?.length, 1);
  assert.match(images[0], /provider-sessions\/images\/tool-[0-9a-f]{32}\.jpg$/);
  assert.equal(readFileSync(images[0]).toString('base64'), JPEG);
});

test('every harness shape of an image block is the same picture', () => {
  const mcp = toolResultParts([{ type: 'image', data: JPEG, mimeType: 'image/jpeg' }]);
  const api = toolResultParts([
    { type: 'image', source: { type: 'base64', data: JPEG, media_type: 'image/jpeg' } },
  ]);
  const codex = toolResultParts([
    { type: 'inputText', text: 'Done.' },
    { type: 'inputImage', imageUrl: `data:image/jpeg;base64,${JPEG}` },
  ]);
  assert.deepEqual(api.images, mcp.images);
  assert.deepEqual(codex, { text: 'Done.', images: mcp.images });
});

test('text results and unknown content read as before', () => {
  assert.deepEqual(toolResultParts('plain'), { text: 'plain' });
  assert.deepEqual(toolResultParts(undefined), { text: '' });
  assert.deepEqual(
    toolResultParts([
      { type: 'text', text: 'a' },
      { type: 'text', text: 'b' },
    ]),
    {
      text: 'a\nb',
    },
  );
  // A format the app cannot show is said, not dumped.
  assert.deepEqual(toolResultParts([{ type: 'image', data: JPEG, mimeType: 'image/tiff' }]), {
    text: 'An image this build cannot show.',
  });
});
