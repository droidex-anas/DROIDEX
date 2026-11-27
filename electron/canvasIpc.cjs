const { app, dialog, ipcMain } = require('electron');
const attachments = require('./attachments.cjs');
const { canvasImageImportResult, pastedSvgDataUrl } = require('./canvasImageImport.cjs');
const { readKitImage } = require('./canvasPreviewAssets.cjs');
const { createCanvasSourceExport, createDesignSystemExport } = require('./canvasSourceExport.cjs');
const { kitStoreRoot } = require('./appProtocols.cjs');
const { getMainWindow, assertMainRenderer } = require('./mainWindow.cjs');

function registerCanvasIpc({
  sidecarSupervisor,
  importCanvasImage,
  canvasPreviewHosts,
  saveCanvasImage,
}) {
  const exportHost = (chooserOptions) => ({
    chooseDirectory: () =>
      dialog.showOpenDialog(getMainWindow(), { buttonLabel: 'Export here', ...chooserOptions }),
    getBridgeInfo: () => sidecarSupervisor.getBridgeInfo(),
    exportToken: () => sidecarSupervisor.canvasExportToken(),
    fetchRequest: fetch,
  });
  const exportCanvasSource = createCanvasSourceExport(
    exportHost({ title: 'Export Canvas source', properties: ['openDirectory'] }),
  );
  const exportDesignSystem = createDesignSystemExport(
    exportHost({ title: 'Export design system', properties: ['openDirectory', 'createDirectory'] }),
  );
  const pickImage = async (owner) => {
    const result = await dialog.showOpenDialog(getMainWindow(), {
      properties: ['openFile'],
      filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'webp', 'svg'] }],
    });
    if (result.canceled || !result.filePaths[0]) return null;
    return canvasImageImportResult(importCanvasImage, owner, result.filePaths[0]);
  };
  ipcMain.handle('canvas-pick-image', (event, { canvasId }) => {
    assertMainRenderer(event);
    return pickImage({ kind: 'canvas', canvasId });
  });
  ipcMain.handle('canvas-drop-image', (event, { canvasId, filePath }) => {
    assertMainRenderer(event);
    return canvasImageImportResult(importCanvasImage, { kind: 'canvas', canvasId }, filePath);
  });
  ipcMain.handle('canvas-pick-kit-image', (event) => {
    assertMainRenderer(event);
    return pickImage({ kind: 'kit' });
  });
  ipcMain.handle('canvas-drop-kit-image', (event, { filePath }) => {
    assertMainRenderer(event);
    return canvasImageImportResult(importCanvasImage, { kind: 'kit' }, filePath);
  });
  // The document shows kit images from here: up to 10 MiB is too large for the bridge socket.
  ipcMain.handle('canvas-read-kit-image', (event, { assetId }) => {
    assertMainRenderer(event);
    return readKitImage(kitStoreRoot(app), assetId);
  });
  const attachmentsDir = attachments.attachmentDirectory();
  // The importer reads a path, so pasted SVG markup passes through the
  // attachments dir; the day-old sweep removes a file discard could not.
  ipcMain.handle('canvas-paste-svg', (event, { canvasId, svg }) => {
    assertMainRenderer(event);
    const importPasted = async (owner) => {
      const dataUrl = pastedSvgDataUrl(svg);
      const filePath = await attachments.saveFile(attachmentsDir, { name: 'pasted.svg', dataUrl });
      try {
        return await importCanvasImage(owner, filePath);
      } finally {
        await attachments.discard(attachmentsDir, filePath).catch(() => {});
      }
    };
    return canvasImageImportResult(importPasted, { kind: 'canvas', canvasId }, null);
  });
  // The board asks main to end one preview guest. Main ends it through the
  // `webContents` it attached and refuses an ID it never attached; it never asks
  // the guest for anything (spec §6).
  ipcMain.handle('canvas-preview-terminate', (event, { guestId }) => {
    assertMainRenderer(event);
    return Number.isSafeInteger(guestId) && canvasPreviewHosts.terminate(guestId);
  });
  ipcMain.handle('canvas-preview-bind', (event, { guestId, binding }) => {
    assertMainRenderer(event);
    return Number.isSafeInteger(guestId) && canvasPreviewHosts.bind(guestId, binding);
  });
  ipcMain.handle('canvas-preview-capture', (event, request) => {
    assertMainRenderer(event);
    return canvasPreviewHosts.capture(request);
  });
  ipcMain.handle('canvas-preview-cancel-capture', (event, request) => {
    assertMainRenderer(event);
    return canvasPreviewHosts.cancelCapture(request?.requestId);
  });
  ipcMain.handle('canvas-thumbnail-read', (event, request) => {
    assertMainRenderer(event);
    return canvasPreviewHosts.readThumbnail(
      request?.canvasId,
      request?.designId,
      request?.revisionId,
    );
  });
  ipcMain.handle('canvas-image-save', (event, request) => {
    assertMainRenderer(event);
    return saveCanvasImage(request);
  });
  ipcMain.handle('canvas-export-source', (event, input) => {
    assertMainRenderer(event);
    return exportCanvasSource(input);
  });
  ipcMain.handle('canvas-export-source-cancel', (event, request) => {
    assertMainRenderer(event);
    exportCanvasSource.cancel(request?.requestId);
  });
  ipcMain.handle('canvas-export-design-system', (event, input) => {
    assertMainRenderer(event);
    return exportDesignSystem(input);
  });
}

module.exports = { registerCanvasIpc };
