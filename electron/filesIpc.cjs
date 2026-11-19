const { app, dialog, session, shell } = require('electron');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const files = require('./files.cjs');
const attachments = require('./attachments.cjs');
const imageSave = require('./imageSave.cjs');
const localImages = require('./localImages.cjs');
const { expandHome } = require('./gitRepository.cjs');
const { listFiles, readFile } = require('./workspaceFiles.cjs');
const { isRemoteSender } = require('./remoteDesktop.cjs');
const { getMainWindow } = require('./mainWindow.cjs');

function registerFilesIpc({ desktopIpc, filesRootAccess }) {
  desktopIpc.handle('pick-directory', async () => {
    const result = await dialog.showOpenDialog({ properties: ['openDirectory'] });
    const selected = result.canceled ? null : (result.filePaths[0] ?? null);
    if (selected) await filesRootAccess.authorize(selected);
    return selected;
  });
  // A Remote browser has no folder dialog for the laptop; it browses with this.
  desktopIpc.handle('list-directories', async ({ path: dir }) => {
    const root = await files.canonicalDirectory(expandHome(dir || '~'));
    const entries = await fsp.readdir(root, { withFileTypes: true });
    const directories = entries
      .filter((entry) => entry.isDirectory() && !entry.name.startsWith('.'))
      .map((entry) => entry.name)
      .sort((a, b) => a.localeCompare(b))
      .slice(0, 2000);
    const parent = path.dirname(root);
    return { path: root, parent: parent === root ? null : parent, directories };
  });
  desktopIpc.handle('pick-files', async () => {
    const result = await dialog.showOpenDialog({ properties: ['openFile', 'multiSelections'] });
    return result.canceled ? [] : result.filePaths;
  });
  // Composer image pastes/drops land in a temp dir and travel to Droid as
  // ordinary @-mentioned paths; discard only ever unlinks inside that dir.
  const attachmentsDir = path.join(os.tmpdir(), 'droidex-attachments');
  desktopIpc.handle('save-image', ({ dataUrl }) => {
    return attachments.save(attachmentsDir, dataUrl);
  });
  // Pasted non-image files (PDF, doc, video, ...) land in the same temp store
  // and likewise travel to Droid as @-mentioned paths.
  desktopIpc.handle('save-attachment', ({ name, dataUrl }) => {
    return attachments.saveFile(attachmentsDir, { name, dataUrl });
  });
  desktopIpc.handle('discard-image', ({ path: target }) => {
    return attachments.discard(attachmentsDir, target);
  });
  desktopIpc.handle('save-image-as', async ({ url, name }) => {
    // Node's fetch decodes data: URLs; only the session's fetch reaches droidex-img.
    const signal = AbortSignal.timeout(30_000);
    const response =
      imageSave.saveableImageProtocol(url) === 'data:'
        ? await fetch(url, { signal })
        : await session.defaultSession.fetch(url, { signal });
    const { mime, data } = await imageSave.readImageResponse(response);
    const defaultPath = path.join(app.getPath('downloads'), imageSave.imageSaveName(name, mime));
    const result = await dialog.showSaveDialog({ defaultPath });
    if (result.canceled || !result.filePath) return { saved: false };
    await fsp.writeFile(result.filePath, data);
    return { saved: true, filePath: result.filePath };
  });
  desktopIpc.handle('list-files', ({ dir }) => {
    return listFiles(dir);
  });
  desktopIpc.handle('read-file', ({ path: filePath }) => {
    return readFile(filePath);
  });
  // A Remote browser cannot load droidex-img URLs, so it asks for the bytes.
  // The tunnel is far slower than the protocol handler, hence the lower cap.
  desktopIpc.handle('local-image-read', ({ url }) => {
    const filePath = localImages.localImageRequestPath(url);
    return localImages.readLocalImage(filePath, { maxBytes: 8 * 1024 * 1024 });
  });
  desktopIpc.handle('files-authorize-root', async ({ root }, sender) => {
    const authorized = await filesRootAccess.tokenFor(root);
    if (authorized) return authorized;
    // A paired browser already has a shell on this account, and nobody may be at
    // the laptop to answer a dialog.
    if (isRemoteSender(sender)) return filesRootAccess.authorize(root);
    const expectedRoot = await files.canonicalDirectory(root);
    const result = await dialog.showOpenDialog(getMainWindow(), {
      title: 'Allow Files access to this workspace',
      buttonLabel: 'Allow Files Access',
      defaultPath: expectedRoot,
      properties: ['openDirectory', 'dontAddToRecent'],
    });
    if (result.canceled || !result.filePaths[0]) {
      throw new Error('Files access was not authorized.');
    }
    const selectedRoot = await files.canonicalDirectory(result.filePaths[0]);
    if (selectedRoot !== expectedRoot) {
      throw new Error('Select the current workspace folder to authorize Files access.');
    }
    return filesRootAccess.authorize(selectedRoot);
  });
  desktopIpc.handle('files-list', ({ accessToken, relative }) => {
    return files.listDirectory(filesRootAccess.resolve(accessToken), relative);
  });
  desktopIpc.handle('files-preview', ({ accessToken, relative }) => {
    return files.readPreview(filesRootAccess.resolve(accessToken), relative);
  });
  desktopIpc.handle('files-open', ({ accessToken, relative }) => {
    return files.openDefault(filesRootAccess.resolve(accessToken), relative, shell);
  });
  desktopIpc.handle('files-reveal', ({ accessToken, relative }) => {
    return files.revealInFolder(filesRootAccess.resolve(accessToken), relative, shell);
  });
}

module.exports = { registerFilesIpc };
