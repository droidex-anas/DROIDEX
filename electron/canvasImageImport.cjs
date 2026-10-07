// Main's file-picker/drop boundary for Canvas. It decodes the selected bytes
// before asking the sidecar to own them; a digest rejects a changed path.

const { createHash } = require('node:crypto');
const { constants } = require('node:fs');
const { open } = require('node:fs/promises');
const { extname, isAbsolute } = require('node:path');
const { imageMediaType } = require('./canvasPreviewAssets.cjs');

const EXTENSIONS = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
};

class CanvasImageImportError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

function invalidImage(message) {
  return new CanvasImageImportError('invalid_input', message);
}

function storageFailure() {
  return new CanvasImageImportError(
    'storage_failed',
    'The image could not be saved. Reopen DROIDEX and try again.',
  );
}

function createCanvasImageImporter(nativeImage, sidecarSupervisor) {
  return async function importCanvasImage(canvasId, filePath) {
    if (
      typeof canvasId !== 'string' ||
      !/^[A-Za-z0-9_-]{1,128}$/.test(canvasId) ||
      typeof filePath !== 'string' ||
      !isAbsolute(filePath)
    )
      throw invalidImage('Choose a canvas and an image first.');
    let bytes;
    try {
      const file = await open(filePath, constants.O_RDONLY | constants.O_NOFOLLOW);
      try {
        const info = await file.stat();
        if (!info.isFile() || info.size < 1 || info.size > 10 * 1024 * 1024)
          throw invalidImage('Choose an image under 10 MiB.');
        bytes = Buffer.alloc(info.size);
        let offset = 0;
        while (offset < bytes.length) {
          const { bytesRead } = await file.read(bytes, offset, bytes.length - offset, offset);
          if (bytesRead === 0) throw invalidImage('The selected image changed. Choose it again.');
          offset += bytesRead;
        }
      } finally {
        await file.close();
      }
    } catch (error) {
      if (error instanceof CanvasImageImportError) throw error;
      throw invalidImage('The selected image could not be read. Choose it again.');
    }

    const expectedType = EXTENSIONS[extname(filePath).toLowerCase()];
    if (!expectedType || imageMediaType(bytes) !== expectedType)
      throw invalidImage('Choose a PNG, JPEG or WebP image whose extension matches its contents.');
    const declared = imageDimensions(bytes, expectedType);
    if (!declared) throw invalidImage('Choose a valid PNG, JPEG or WebP image.');
    assertImageDimensions(declared.width, declared.height);

    let width;
    let height;
    try {
      if (expectedType === 'image/webp') {
        const { createCanvas, loadImage } = require('@napi-rs/canvas');
        const decoded = await loadImage(bytes);
        ({ width, height } = decoded);
        assertImageDimensions(width, height);
        createCanvas(1, 1).getContext('2d').drawImage(decoded, 0, 0, 1, 1);
      } else {
        const decoded = nativeImage.createFromBuffer(bytes);
        if (decoded.isEmpty()) throw invalidImage('Choose a valid PNG or JPEG image.');
        ({ width, height } = decoded.getSize());
        assertImageDimensions(width, height);
        // Force pixel decode, so a plausible header with a broken body is refused.
        if (decoded.toBitmap().length !== width * height * 4)
          throw invalidImage('The selected image could not be decoded.');
      }
    } catch (error) {
      if (error instanceof CanvasImageImportError) throw error;
      throw invalidImage('The selected image could not be decoded.');
    }

    let response;
    try {
      const { port } = await sidecarSupervisor.getBridgeInfo();
      response = await fetch(`http://127.0.0.1:${String(port)}/canvas/import-image`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-canvas-secret': sidecarSupervisor.canvasAssetSecret(),
        },
        body: JSON.stringify({
          canvasId,
          filePath,
          digest: createHash('sha256').update(bytes).digest('hex'),
          width,
          height,
        }),
        signal: AbortSignal.timeout(15_000),
      });
    } catch {
      throw storageFailure();
    }
    let answer;
    try {
      answer = await response.json();
    } catch {
      throw storageFailure();
    }
    if (!response.ok) {
      if (
        (answer?.code === 'invalid_input' || answer?.code === 'storage_failed') &&
        typeof answer.message === 'string'
      )
        throw new CanvasImageImportError(answer.code, answer.message);
      throw storageFailure();
    }
    return answer;
  };
}

function assertImageDimensions(width, height) {
  if (width < 1 || height < 1 || width > 8192 || height > 8192)
    throw invalidImage('Choose an image at most 8192 pixels per side.');
}

function imageDimensions(bytes, mediaType) {
  if (mediaType === 'image/png') {
    if (
      bytes.length < 33 ||
      bytes.readUInt32BE(8) !== 13 ||
      bytes.toString('ascii', 12, 16) !== 'IHDR'
    )
      return null;
    return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
  }
  if (mediaType === 'image/jpeg') return jpegDimensions(bytes);
  return webpDimensions(bytes);
}

function jpegDimensions(bytes) {
  let offset = 2;
  while (offset + 4 <= bytes.length) {
    if (bytes[offset++] !== 0xff) return null;
    while (bytes[offset] === 0xff) offset += 1;
    const marker = bytes[offset++];
    if (marker === 0xda || marker === 0xd9) return null;
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;
    if (offset + 2 > bytes.length) return null;
    const length = bytes.readUInt16BE(offset);
    if (length < 2 || offset + length > bytes.length) return null;
    if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
      if (length < 8) return null;
      return {
        width: bytes.readUInt16BE(offset + 5),
        height: bytes.readUInt16BE(offset + 3),
      };
    }
    offset += length;
  }
  return null;
}

function webpDimensions(bytes) {
  const end = bytes.readUInt32LE(4) + 8;
  if (end > bytes.length) return null;
  let offset = 12;
  while (offset + 8 <= end) {
    const chunk = bytes.toString('ascii', offset, offset + 4);
    const length = bytes.readUInt32LE(offset + 4);
    const body = offset + 8;
    if (body + length > end) return null;
    if (chunk === 'VP8X' && length >= 10)
      return {
        width: bytes.readUIntLE(body + 4, 3) + 1,
        height: bytes.readUIntLE(body + 7, 3) + 1,
      };
    if (chunk === 'VP8L' && length >= 5 && bytes[body] === 0x2f) {
      const dimensions = bytes.readUInt32LE(body + 1);
      return { width: (dimensions & 0x3fff) + 1, height: ((dimensions >>> 14) & 0x3fff) + 1 };
    }
    if (
      chunk === 'VP8 ' &&
      length >= 10 &&
      bytes.subarray(body + 3, body + 6).equals(Buffer.from('9d012a', 'hex'))
    )
      return {
        width: bytes.readUInt16LE(body + 6) & 0x3fff,
        height: bytes.readUInt16LE(body + 8) & 0x3fff,
      };
    offset = body + length + (length % 2);
  }
  return null;
}

async function canvasImageImportResult(importImage, canvasId, filePath) {
  try {
    return { ok: true, asset: await importImage(canvasId, filePath) };
  } catch (error) {
    const failure = error instanceof CanvasImageImportError ? error : storageFailure();
    return { ok: false, error: { code: failure.code, message: failure.message } };
  }
}

module.exports = { createCanvasImageImporter, canvasImageImportResult };
