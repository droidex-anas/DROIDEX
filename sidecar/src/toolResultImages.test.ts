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
  const droid = toolResultParts([
    { type: 'image', source: { type: 'base64', data: JPEG, mediaType: 'image/jpeg' } },
  ]);
  assert.deepEqual(droid.images, mcp.images);
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
  assert.deepEqual(
    toolResultParts([
      { type: 'text', text: 'a' },
      { type: 'text', text: '' },
      { type: 'text', text: 'b' },
    ]).text,
    'a\n\nb',
  );
});

test('an image the app cannot save is one plain line, never its bytes', () => {
  const unshown = { text: 'An image this build cannot show.' };
  // Bytes that are not a picture, whatever the block calls them.
  const notAnImage = Buffer.from('not a picture').toString('base64');
  assert.deepEqual(
    toolResultParts([{ type: 'image', data: notAnImage, mimeType: 'image/png' }]),
    unshown,
  );
  // An image block with nothing in it is still an image, not text.
  assert.deepEqual(toolResultParts([{ type: 'image' }]), unshown);
});

test('a picture is known by its own bytes', () => {
  // The type a block claims is not needed, and a data URL may carry parameters.
  assert.equal(toolResultParts([{ type: 'image', data: JPEG }]).images?.length, 1);
  const withParameter = toolResultParts([
    { type: 'inputImage', imageUrl: `data:image/jpeg;charset=utf-8;base64,${JPEG}` },
  ]);
  assert.match(withParameter.images?.[0] ?? '', /\.jpg$/);
});
