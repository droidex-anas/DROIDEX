/**
 * "Download" for the image viewers: the main process fetches the image and
 * writes it where the user picks. The renderer cannot read the bytes itself
 * because droidex-img responses are cross-origin to it, and widening that
 * scheme with CORS would also expose local images to sandboxed app blocks.
 *
 * Kept free of `require('electron')` so it can be unit-tested under plain Node.
 */

const { sanitizeAttachmentName } = require('./attachments.cjs');
const { MAX_IMAGE_BYTES, imageExtensionForMime } = require('./localImages.cjs');

const SAVEABLE_PROTOCOLS = new Set(['droidex-img:', 'data:', 'https:', 'http:']);

/** The URL's protocol, or throws for a scheme the viewers never display. */
function saveableImageProtocol(url) {
  const { protocol } = new URL(url);
  if (!SAVEABLE_PROTOCOLS.has(protocol)) throw new Error(`Cannot save an image from ${protocol}`);
  return protocol;
}

// Counts bytes as they arrive: a server can omit or understate Content-Length,
// and buffering the whole body before checking would let it fill main's memory.
async function readBoundedBody(body, maxBytes) {
  if (!body) return Buffer.alloc(0);
  const reader = body.getReader();
  const chunks = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) return Buffer.concat(chunks, total);
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      throw new Error('Image exceeds the size limit');
    }
    chunks.push(value);
  }
}

/** Reads an image response within the local-image size cap. */
async function readImageResponse(response, maxBytes = MAX_IMAGE_BYTES) {
  if (!response.ok) throw new Error(`Image request failed with status ${String(response.status)}`);
  const mime = (response.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase();
  if (!mime.startsWith('image/')) throw new Error('Response is not an image');
  if (Number(response.headers.get('content-length')) > maxBytes) {
    throw new Error('Image exceeds the size limit');
  }
  return { mime, data: await readBoundedBody(response.body, maxBytes) };
}

/** A safe default file name for the save dialog, with an extension for its type. */
function imageSaveName(name, mime) {
  const base = sanitizeAttachmentName(name) ?? 'image';
  const ext = imageExtensionForMime(mime);
  if (!ext || /\.[a-z0-9]{2,5}$/i.test(base)) return base;
  return `${base}.${ext}`;
}

module.exports = { imageSaveName, readImageResponse, saveableImageProtocol };
