const { validPng, MAX_CAPTURE_BYTES } = require('./canvasPreviewHosts.cjs');

const BAD_IMAGE = {
  ok: false,
  code: 'capture_unavailable',
  message: 'Capture this design again.',
};

/** Only an OS-chosen destination receives a captured PNG. */
function createCanvasImageSave({ dialog, writeFile, getWindow }) {
  return async (request) => {
    const bytes = request?.bytes;
    if (!(bytes instanceof Uint8Array) || bytes.byteLength > MAX_CAPTURE_BYTES) return BAD_IMAGE;
    const png = Buffer.from(bytes);
    if (png.length < 24 || !validPng(png, png.readUInt32BE(16), png.readUInt32BE(20), 1))
      return BAD_IMAGE;
    const window = getWindow();
    if (!window) return BAD_IMAGE;
    const name =
      typeof request.suggestedName === 'string' ? request.suggestedName.trim().slice(0, 120) : '';
    const safeName = name.replace(/[^A-Za-z0-9 _.-]/g, '_').replace(/^\.+/, '') || 'design';
    try {
      const result = await dialog.showSaveDialog(window, {
        defaultPath: `${safeName}.png`,
        filters: [{ name: 'PNG image', extensions: ['png'] }],
      });
      if (result.canceled || !result.filePath) return { ok: false, cancelled: true };
      await writeFile(result.filePath, png);
      return { ok: true };
    } catch {
      return {
        ok: false,
        code: 'storage_failed',
        message: 'The image could not be saved. Choose another location and try again.',
      };
    }
  };
}

module.exports = { createCanvasImageSave };
