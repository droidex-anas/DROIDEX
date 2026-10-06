// Main's file-picker/drop boundary for Canvas. It decodes the selected bytes
// before asking the sidecar to own them; a digest rejects a changed path.

const { createHash } = require('node:crypto');
const { constants } = require('node:fs');
const { open } = require('node:fs/promises');
const { isAbsolute } = require('node:path');

function createCanvasImageImporter(nativeImage, sidecarSupervisor) {
  return async function importCanvasImage(canvasId, filePath) {
    if (!/^[A-Za-z0-9_-]{1,128}$/.test(canvasId) || !isAbsolute(filePath))
      throw new Error('Choose a canvas and an image first.');
    const file = await open(filePath, constants.O_RDONLY | constants.O_NOFOLLOW);
    let bytes;
    try {
      const info = await file.stat();
      if (!info.isFile() || info.size < 1 || info.size > 10 * 1024 * 1024)
        throw new Error('Choose an image under 10 MiB.');
      bytes = Buffer.alloc(info.size);
      let offset = 0;
      while (offset < bytes.length) {
        const { bytesRead } = await file.read(bytes, offset, bytes.length - offset, offset);
        if (bytesRead === 0) throw new Error('The selected image changed. Choose it again.');
        offset += bytesRead;
      }
    } finally {
      await file.close();
    }
    const decoded = nativeImage.createFromBuffer(bytes);
    if (decoded.isEmpty()) throw new Error('Choose a valid PNG, JPEG or WebP image.');
    const { width, height } = decoded.getSize();
    if (width < 1 || height < 1 || width > 8192 || height > 8192)
      throw new Error('Choose an image at most 8192 pixels per side.');
    // Force pixel decode, so a plausible header with a broken body is refused.
    if (decoded.toBitmap().length !== width * height * 4)
      throw new Error('The selected image could not be decoded.');

    const { port } = await sidecarSupervisor.getBridgeInfo();
    const response = await fetch(`http://127.0.0.1:${String(port)}/canvas/import-image`, {
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
    const answer = await response.json();
    if (!response.ok) throw new Error(answer.message || 'The image could not be imported.');
    return answer;
  };
}

module.exports = { createCanvasImageImporter };
