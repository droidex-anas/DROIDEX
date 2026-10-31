const { randomUUID } = require('node:crypto');
const path = require('node:path');

const BAD_IMAGE = {
  ok: false,
  code: 'capture_unavailable',
  message: 'Capture this design again.',
};

/** Only an OS-chosen destination receives a captured PNG. */
function createCanvasImageSave({ dialog, fs, getWindow, readThumbnail }) {
  return async (request) => {
    const png = readThumbnail(request?.canvasId, request?.designId, request?.revisionId);
    if (!png) return BAD_IMAGE;
    const window = getWindow();
    if (!window) return BAD_IMAGE;
    const name =
      typeof request.suggestedName === 'string' ? request.suggestedName.trim().slice(0, 120) : '';
    const safeName = name.replace(/[^A-Za-z0-9 _.-]/g, '_').replace(/^\.+/, '') || 'design';
    let temporaryPath;
    try {
      const result = await dialog.showSaveDialog(window, {
        defaultPath: `${safeName}.png`,
        filters: [{ name: 'PNG image', extensions: ['png'] }],
      });
      if (result.canceled || !result.filePath) return { ok: false, cancelled: true };
      const stagingPath = path.join(
        path.dirname(result.filePath),
        `.canvas-image-${randomUUID()}.tmp`,
      );
      const file = await fs.open(stagingPath, 'wx', 0o600);
      temporaryPath = stagingPath;
      try {
        await file.writeFile(png);
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
