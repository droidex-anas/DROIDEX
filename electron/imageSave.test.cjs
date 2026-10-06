const test = require('node:test');
const assert = require('node:assert/strict');

const { MAX_IMAGE_BYTES } = require('./localImages.cjs');
const { imageSaveName, readImageResponse, saveableImageProtocol } = require('./imageSave.cjs');

test('saveableImageProtocol accepts the schemes the viewers display and refuses the rest', () => {
  assert.equal(saveableImageProtocol('droidex-img://local/?p=%2Ftmp%2Fa.png'), 'droidex-img:');
  assert.equal(saveableImageProtocol('data:image/png;base64,AAAA'), 'data:');
  assert.equal(saveableImageProtocol('https://example.com/a.png'), 'https:');

  assert.throws(() => saveableImageProtocol('file:///etc/passwd'), /Cannot save/);
  assert.throws(() => saveableImageProtocol('droidex-favicon://example.com'), /Cannot save/);
  assert.throws(() => saveableImageProtocol('not a url'));
});

test('readImageResponse returns image bytes and refuses failures, non-images, and oversized bodies', async () => {
  const png = new Response(Buffer.from('png'), {
    headers: { 'content-type': 'image/PNG; charset=binary' },
  });
  const { mime, data } = await readImageResponse(png);
  assert.equal(mime, 'image/png');
  assert.equal(data.toString(), 'png');

  await assert.rejects(readImageResponse(new Response('gone', { status: 404 })), /status 404/);
  await assert.rejects(
    readImageResponse(new Response('<html>', { headers: { 'content-type': 'text/html' } })),
    /not an image/,
  );
  const huge = new Response('x', {
    headers: { 'content-type': 'image/png', 'content-length': String(MAX_IMAGE_BYTES + 1) },
  });
  await assert.rejects(readImageResponse(huge), /size limit/);
});

test('imageSaveName keeps a usable name, strips path parts, and adds the type extension', () => {
  assert.equal(imageSaveName('shot.png', 'image/png'), 'shot.png');
  assert.equal(imageSaveName('Mermaid diagram', 'image/svg+xml'), 'Mermaid diagram.svg');
  assert.equal(imageSaveName('photo', 'image/jpeg'), 'photo.jpg');
  assert.equal(imageSaveName('../../etc/evil', 'image/png'), 'evil.png');
  assert.equal(imageSaveName('', 'image/webp'), 'image.webp');
});
