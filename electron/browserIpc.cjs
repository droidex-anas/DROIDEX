const { ipcMain } = require('electron');
const { getMainWindow } = require('./mainWindow.cjs');

function registerBrowserIpc({
  desktopIpc,
  nativeBrowserManager,
  nativeBrowserRequests,
  nativeBrowserShortcuts,
}) {
  desktopIpc.handle('native-browser-reserve', ({ browserSessionId, savedUrl, savedMode }) => {
    return nativeBrowserManager.reserve(
      browserSessionId,
      getMainWindow().webContents,
      savedUrl,
      savedMode,
    );
  });
  desktopIpc.handle('native-browser-release', ({ browserSessionId }) => {
    return nativeBrowserManager.release(browserSessionId);
  });
  desktopIpc.handle('native-browser-working-sessions', () => {
    return nativeBrowserRequests.workingSessions();
  });
  desktopIpc.handle('native-browser-shown', ({ browserSessionId, shown }) => {
    return nativeBrowserManager.setShown(browserSessionId, shown);
  });
  desktopIpc.handle('native-browser-watch', ({ browserSessionId, watching }) => {
    return nativeBrowserManager.watch(browserSessionId, watching);
  });
  desktopIpc.handle('native-browser-go-back', ({ browserSessionId }) => {
    return nativeBrowserManager.goBack(browserSessionId);
  });
  desktopIpc.handle('native-browser-go-forward', ({ browserSessionId }) => {
    return nativeBrowserManager.goForward(browserSessionId);
  });
  desktopIpc.handle('native-browser-set-design-state', ({ browserSessionId, state }) => {
    return nativeBrowserManager.setDesignState(browserSessionId, state);
  });
  desktopIpc.handle('native-browser-set-shortcuts', ({ chords }) => {
    nativeBrowserShortcuts.setChords(chords);
  });

  // A page in design mode reports what the user picked, where its marks are
  // as it scrolls, and the keys meant for the app, passed on at once. A pick's
  // crop, taken while its mark shows, follows as a shot for that pick, so
  // Escape and an unselect never wait on a capture.
  let designPicks = 0;
  ipcMain.on('native-browser-design-event', (event, payload) => {
    const browserSessionId = nativeBrowserManager.sessionIdForWebContents(event.sender);
    const types = ['select', 'unselect', 'boxes', 'key'];
    if (!browserSessionId || !types.includes(payload?.type)) return;
    const send = (next) =>
      getMainWindow()?.webContents.send('native-browser-design-event', {
        ...next,
        browserSessionId,
      });
    if (payload.type !== 'select') {
      send(payload);
      return;
    }
    const pick = ++designPicks;
    send({ ...payload, pick });
    void nativeBrowserManager
      .captureDesignSelection(event.sender, payload.selection)
      .catch(() => undefined)
      .then((screenshot) => send({ type: 'shot', pick, screenshot }));
  });
  ipcMain.on('native-browser-credential-capture', (event, payload) => {
    void nativeBrowserManager.handleCredentialCapture(event.sender, payload);
  });
}

module.exports = { registerBrowserIpc };
