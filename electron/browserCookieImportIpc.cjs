const { serializeCookieImportFailure } = require('./browserCookieImports.cjs');

function registerBrowserCookieImportIpc({ ipcMain, imports, assertMainRenderer }) {
  for (const [channel, action] of [
    ['browser-cookie-profiles-discover', () => imports.discoverProfiles()],
    [
      'browser-cookie-profile-import-prepare',
      (request) => imports.prepareProfile(request?.profileId),
    ],
    ['browser-cookie-profile-import-commit', (request) => imports.commitProfile(request?.planId)],
    ['browser-cookie-profile-import-discard', (request) => imports.discardProfile(request?.planId)],
    ['browser-cookies-import', (request) => imports.importFile(request?.filePath)],
  ]) {
    ipcMain.handle(channel, async (event, argument) => {
      assertMainRenderer(event);
      try {
        return await action(argument);
      } catch (error) {
        throw serializeCookieImportFailure(error);
      }
    });
  }
}

module.exports = { registerBrowserCookieImportIpc };
