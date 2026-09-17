const path = require('node:path');
const { fileURLToPath } = require('node:url');

function isRemoteSettingsSender(event, appPath, devUrl) {
  if (event.senderFrame !== event.sender.mainFrame) return false;
  try {
    const actual = new URL(event.sender.getURL());
    if (devUrl) {
      const expected = new URL(devUrl);
      return actual.origin === expected.origin && actual.pathname === expected.pathname;
    }
    return actual.protocol === 'file:' && path.resolve(fileURLToPath(actual)) === path.join(appPath, 'dist', 'index.html');
  } catch { return false; }
}

module.exports = { isRemoteSettingsSender };
