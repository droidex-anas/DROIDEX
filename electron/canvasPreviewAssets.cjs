// The preview scheme's only subresources: canvas-owned images and installed kit
// fonts. URLs contain IDs, never private paths; every disk read stays under an
// app-owned directory and refuses links below the profile root.

const { createHash, createHmac, timingSafeEqual } = require('node:crypto');
const { constants } = require('node:fs');
const { lstat, open } = require('node:fs/promises');
const { join } = require('node:path');

const HASH = '[0-9a-f]{64}';
const CANVAS_ASSET = new RegExp(`^/asset/([A-Za-z0-9_-]{1,128})/(${HASH})$`);
const KIT_FONT = new RegExp(`^/font/(${HASH})$`);

async function readCanvasPreviewAsset(requestUrl, { canvasRoot, fontRoot, secret }) {
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

  const font = KIT_FONT.exec(url.pathname);
  if (!font || url.search) return null;
  const [, fontId] = font;
  const data = await readOwnedFile(join(fontRoot, fontId), [fontRoot], 1024 * 1024);
  if (!data || createHash('sha256').update(data).digest('hex') !== fontId) return null;
  return data.toString('ascii', 0, 4) === 'wOF2' ? { mime: 'font/woff2', data } : null;
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

module.exports = { readCanvasPreviewAsset, imageMediaType };
