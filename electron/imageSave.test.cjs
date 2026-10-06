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

test('readImageResponse stops reading a body with no length as soon as it passes the cap', async () => {
  let chunksPulled = 0;
  let cancelled = false;
  const endless = new ReadableStream({
    pull(controller) {
      chunksPulled += 1;
      controller.enqueue(new Uint8Array(4));
    },
    cancel() {
      cancelled = true;
    },
  });
  const response = new Response(endless, { headers: { 'content-type': 'image/png' } });

  await assert.rejects(readImageResponse(response, 10), /size limit/);
  assert.equal(cancelled, true);
  assert.ok(chunksPulled <= 4, `read ${String(chunksPulled)} chunks past a 10-byte cap`);
});

test('imageSaveName keeps a usable name, strips path parts, and gives it the extension of its type', () => {
  assert.equal(imageSaveName('shot.png', 'image/png'), 'shot.png');
  assert.equal(imageSaveName('photo.JPEG', 'image/jpeg'), 'photo.JPEG');
  assert.equal(imageSaveName('photo.jpg', 'image/png'), 'photo.png');
  assert.equal(imageSaveName('Mermaid diagram.v2', 'image/svg+xml'), 'Mermaid diagram.v2.svg');
  assert.equal(imageSaveName('Mermaid diagram', 'image/svg+xml'), 'Mermaid diagram.svg');
  assert.equal(imageSaveName('photo', 'image/jpeg'), 'photo.jpg');
  assert.equal(imageSaveName('../../etc/evil', 'image/png'), 'evil.png');
  assert.equal(imageSaveName('', 'image/webp'), 'image.webp');
});
