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

/** Reads an image response within the local-image size cap. */
async function readImageResponse(response) {
  if (!response.ok) throw new Error(`Image request failed with status ${String(response.status)}`);
  const mime = (response.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase();
  if (!mime.startsWith('image/')) throw new Error('Response is not an image');
  if (Number(response.headers.get('content-length')) > MAX_IMAGE_BYTES) {
    throw new Error('Image exceeds the size limit');
  }
  const data = Buffer.from(await response.arrayBuffer());
  if (data.byteLength > MAX_IMAGE_BYTES) throw new Error('Image exceeds the size limit');
  return { mime, data };
}

/** A safe default file name for the save dialog, with an extension for its type. */
function imageSaveName(name, mime) {
  const base = sanitizeAttachmentName(name) ?? 'image';
  const ext = imageExtensionForMime(mime);
  if (!ext || /\.[a-z0-9]{2,5}$/i.test(base)) return base;
  return `${base}.${ext}`;
}

module.exports = { imageSaveName, readImageResponse, saveableImageProtocol };
