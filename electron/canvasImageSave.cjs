const { randomUUID } = require('node:crypto');
const path = require('node:path');

const BAD_IMAGE = {
  ok: false,
  code: 'capture_unavailable',
  message: 'Capture this design again.',
};
const UNSAFE_SVG = {
  ok: false,
  code: 'capture_unavailable',
  message: 'This SVG could not be made safe to save. Export it as a PNG instead.',
};
/** The sidecar refuses markup over 256 KiB; a string longer than that never has fewer bytes. */
const MAX_SVG_LENGTH = 256 * 1024;

/**
 * Markup from a design is untrusted, so only what the sidecar's sanitiser
 * rebuilt is ever written; null when it refused or could not be reached.
 */
async function sanitisedSvg(sidecar, svg) {
  if (typeof svg !== 'string' || svg.length > MAX_SVG_LENGTH) return null;
  try {
    const { port } = await sidecar.getBridgeInfo();
    const response = await fetch(`http://127.0.0.1:${String(port)}/canvas/sanitise-svg`, {
      method: 'POST',
      headers: {
        'content-type': 'image/svg+xml',
        'x-canvas-secret': sidecar.canvasAssetSecret(),
      },
      body: svg,
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) return null;
    return Buffer.from(await response.arrayBuffer());
  } catch {
    return null;
  }
}

/**
 * Only an OS-chosen destination receives an image: the PNG main kept for the
 * capture request it names, or a design's SVG once the sidecar has sanitised it.
 */
function createCanvasImageSave({ dialog, fs, getWindow, takeCapture, sidecar }) {
  return async (request) => {
    const isSvg = request?.format === 'svg';
    const image = isSvg
      ? await sanitisedSvg(sidecar, request.svg)
      : takeCapture(request?.requestId);
    if (!image) return isSvg ? UNSAFE_SVG : BAD_IMAGE;
    const window = getWindow();
    if (!window) return BAD_IMAGE;
    const extension = isSvg ? 'svg' : 'png';
    const name =
      typeof request.suggestedName === 'string' ? request.suggestedName.trim().slice(0, 120) : '';
    const safeName = name.replace(/[^A-Za-z0-9 _.-]/g, '_').replace(/^\.+/, '') || 'design';
    let temporaryPath;
    try {
      const result = await dialog.showSaveDialog(window, {
        defaultPath: `${safeName}.${extension}`,
        filters: [{ name: isSvg ? 'SVG image' : 'PNG image', extensions: [extension] }],
      });
      if (result.canceled || !result.filePath) return { ok: false, cancelled: true };
      const stagingPath = path.join(
        path.dirname(result.filePath),
        `.canvas-image-${randomUUID()}.tmp`,
      );
      const file = await fs.open(stagingPath, 'wx', 0o600);
      temporaryPath = stagingPath;
      try {
        await file.writeFile(image);
        await file.sync();
      } finally {
        await file.close();
      }
      await fs.rename(temporaryPath, result.filePath);
      return { ok: true };
    } catch {
      if (temporaryPath) {
        try {
          await fs.unlink(temporaryPath);
        } catch {
          return {
            ok: false,
            code: 'storage_failed',
            message: 'The image could not be saved, and its temporary file could not be removed.',
          };
        }
      }
      return {
        ok: false,
        code: 'storage_failed',
        message: 'The image could not be saved. Choose another location and try again.',
      };
    }
  };
}

module.exports = { createCanvasImageSave };
