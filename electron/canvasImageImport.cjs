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

    let width;
    let height;
    try {
      if (expectedType === 'image/webp') {
        const { createCanvas, loadImage } = require('@napi-rs/canvas');
        const decoded = await loadImage(bytes);
        ({ width, height } = decoded);
        if (width < 1 || height < 1 || width > 8192 || height > 8192)
          throw invalidImage('Choose an image at most 8192 pixels per side.');
        createCanvas(1, 1).getContext('2d').drawImage(decoded, 0, 0, 1, 1);
      } else {
        const decoded = nativeImage.createFromBuffer(bytes);
        if (decoded.isEmpty()) throw invalidImage('Choose a valid PNG or JPEG image.');
        ({ width, height } = decoded.getSize());
        if (width < 1 || height < 1 || width > 8192 || height > 8192)
          throw invalidImage('Choose an image at most 8192 pixels per side.');
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

async function canvasImageImportResult(importImage, canvasId, filePath) {
  try {
    return { ok: true, asset: await importImage(canvasId, filePath) };
  } catch (error) {
    const failure = error instanceof CanvasImageImportError ? error : storageFailure();
    return { ok: false, error: { code: failure.code, message: failure.message } };
  }
}

module.exports = { createCanvasImageImporter, canvasImageImportResult };
