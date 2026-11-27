const { getMainWindow, isWindowUsable } = require('./mainWindow.cjs');

function registerRendererStorageIpc({ desktopIpc, remoteDesktop }) {
  // Projects and appearance live in the window's localStorage; a Remote
  // browser starts from the laptop's copy instead of an empty app.
  desktopIpc.handle('renderer-storage-read', ({ keys } = {}) => {
    if (
      !Array.isArray(keys) ||
      keys.length > 16 ||
      !keys.every((key) => typeof key === 'string' && /^droid-[a-z0-9-]{1,60}$/.test(key))
    )
      throw new Error('Invalid storage keys');
    if (!isWindowUsable(getMainWindow())) throw new Error('Open the DROIDEX window on your laptop');
    return getMainWindow().webContents.executeJavaScript(
      `Object.fromEntries(${JSON.stringify(keys)}.map((key) => [key, localStorage.getItem(key)]))`,
    );
  });
  // Projects and chat organization are one list: a change in the window or in
  // any Remote browser reaches every other copy of the app.
  const SHARED_STORAGE_KEYS = new Set(['droid-workspaces', 'droid-chat-metadata']);
  desktopIpc.handle('shared-storage-write', ({ key, value } = {}, sender) => {
    if (!SHARED_STORAGE_KEYS.has(key) || typeof value !== 'string' || value.length > 2_000_000)
      throw new Error('Invalid shared storage value');
    const change = { key, value };
    if (isWindowUsable(getMainWindow()) && getMainWindow().webContents !== sender) {
      getMainWindow().webContents.send('shared-storage-changed', change);
    }
    remoteDesktop.broadcast('shared-storage-changed', change, sender);
  });
}

module.exports = { registerRendererStorageIpc };
