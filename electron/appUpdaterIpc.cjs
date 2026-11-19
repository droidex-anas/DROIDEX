const { app } = require('electron');

function registerAppUpdaterIpc({ desktopIpc, appUpdater }) {
  desktopIpc.handle('app-version', () => {
    return app.getVersion();
  });
  desktopIpc.handle('app-check-update', (options) => {
    return appUpdater.check(options);
  });
  desktopIpc.handle('app-download-update', () => {
    return appUpdater.downloadAndInstall();
  });
}

module.exports = { registerAppUpdaterIpc };
