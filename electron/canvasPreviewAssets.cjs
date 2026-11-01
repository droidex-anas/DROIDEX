// The preview scheme's only subresources: canvas-owned images, kit images and
// installed kit fonts. URLs contain IDs, never private paths; every disk read
// stays under an app-owned directory and refuses links below the profile root.

const { createHash, createHmac, timingSafeEqual } = require('node:crypto');
const { constants } = require('node:fs');
const { lstat, open } = require('node:fs/promises');
const { join } = require('node:path');

const HASH = '[0-9a-f]{64}';
const CANVAS_ASSET = new RegExp(`^/asset/([A-Za-z0-9_-]{1,128})/(${HASH})$`);
const KIT_ASSET_ID = new RegExp(`^${HASH}$`);
const KIT_ASSET = new RegExp(`^/kit-asset/(${HASH})$`);
const KIT_FONT = new RegExp(`^/font/(${HASH})$`);
const IMAGE_CANVAS = /^\/asset\/([A-Za-z0-9_-]{1,128})\//;

/**
 * Whether a guest with this binding may request this preview URL: any bound
 * guest reads kit images and fonts, and only a guest bound to a canvas reads
 * that canvas's images.
 */
function mayRequestPreviewAsset(binding, requestUrl) {
  if (binding === null) return false;
  const image = IMAGE_CANVAS.exec(new URL(requestUrl).pathname);
  if (!image) return true;
  return binding.kind === 'canvas' && image[1] === binding.canvasId;
}

async function readCanvasPreviewAsset(requestUrl, { canvasRoot, kitRoot, fontRoot, secret }) {
  const url = new URL(requestUrl);
  if (url.protocol !== 'droidex-canvas-preview:' || url.host !== 'preview') return null;
  const image = CANVAS_ASSET.exec(url.pathname);
  if (image) {
    if ([...url.searchParams.keys()].join(',') !== 'sig') return null;
    const [, canvasId, assetId] = image;
    const supplied = url.searchParams.get('sig');
    if (!/^[0-9a-f]{64}$/.test(supplied || '')) return null;
    const expected = createHmac('sha256', secret).update(`${canvasId}\0${assetId}`).digest();
    if (!timingSafeEqual(expected, Buffer.from(supplied, 'hex'))) return null;
    const canvas = join(canvasRoot, canvasId);
    const assets = join(canvas, 'assets');
    const data = await readOwnedFile(join(assets, assetId), [canvas, assets], 10 * 1024 * 1024);
    if (!data || createHash('sha256').update(data).digest('hex') !== assetId) return null;
    const mime = imageMediaType(data);
    return mime ? { mime, data } : null;
  }

  const kitImage = KIT_ASSET.exec(url.pathname);
  if (kitImage) return url.search ? null : readKitImage(kitRoot, kitImage[1]);

  const font = KIT_FONT.exec(url.pathname);
  if (!font || url.search) return null;
  const [, fontId] = font;
  const data = await readOwnedFile(join(fontRoot, fontId), [fontRoot], 1024 * 1024);
  if (!data || createHash('sha256').update(data).digest('hex') !== fontId) return null;
  return data.toString('ascii', 0, 4) === 'wOF2' ? { mime: 'font/woff2', data } : null;
}

/** A kit image by its content hash, for preview guests and the document alike. */
async function readKitImage(kitRoot, assetId) {
  if (typeof assetId !== 'string' || !KIT_ASSET_ID.test(assetId)) return null;
  const assets = join(kitRoot, 'assets');
  const data = await readOwnedFile(join(assets, assetId), [kitRoot, assets], 10 * 1024 * 1024);
  if (!data || createHash('sha256').update(data).digest('hex') !== assetId) return null;
  const mime = imageMediaType(data);
  return mime ? { mime, data } : null;
}

async function readOwnedFile(target, directories, maxBytes) {
  try {
    for (const directory of directories) {
      const info = await lstat(directory);
      if (!info.isDirectory() || info.isSymbolicLink()) return null;
    }
    const file = await open(target, constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
      const info = await file.stat();
      if (!info.isFile() || info.size < 1 || info.size > maxBytes) return null;
      const data = Buffer.alloc(info.size);
      let offset = 0;
      while (offset < data.length) {
        const { bytesRead } = await file.read(data, offset, data.length - offset, offset);
        if (bytesRead === 0) return null;
        offset += bytesRead;
      }
      return data;
    } finally {
      await file.close();
    }
  } catch {
    return null;
  }
}

function imageMediaType(data) {
  if (data.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex'))) return 'image/png';
  if (data.length >= 3 && data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff)
    return 'image/jpeg';
  if (data.toString('ascii', 0, 4) === 'RIFF' && data.toString('ascii', 8, 12) === 'WEBP')
    return 'image/webp';
  return null;
}

module.exports = { readCanvasPreviewAsset, readKitImage, mayRequestPreviewAsset, imageMediaType };
