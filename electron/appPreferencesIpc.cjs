const { setAppIcon } = require('./appIcon.cjs');
const { getApiKey, setApiKey } = require('./apiKeyStore.cjs');
const { getOnboarding, setOnboarding } = require('./onboardingStore.cjs');
const { openExternal } = require('./externalLinks.cjs');
const {
  loadHardwareAccelerationPreference,
  saveHardwareAccelerationPreference,
} = require('./hardwareAcceleration.cjs');
const fsp = require('node:fs/promises');

function registerAppPreferencesIpc({
  desktopIpc,
  hardwareAccelerationPreferencePath,
  relaunchApp,
}) {
  desktopIpc.handle('get-api-key', () => {
    return getApiKey();
  });
  desktopIpc.handle('set-api-key', ({ key }) => {
    return setApiKey(key);
  });
  desktopIpc.handle('onboarding-get', () => {
    return getOnboarding();
  });
  desktopIpc.handle('onboarding-set', ({ patch }) => {
    return setOnboarding(patch);
  });
  desktopIpc.handle('hardware-acceleration-preference-get', () => {
    return loadHardwareAccelerationPreference({
      filePath: hardwareAccelerationPreferencePath,
      fs: fsp,
    });
  });
  desktopIpc.handle('hardware-acceleration-preference-set', async ({ enabled }) => {
    return saveHardwareAccelerationPreference({
      filePath: hardwareAccelerationPreferencePath,
      enabled,
      fs: fsp,
    });
  });
  desktopIpc.handle('app-relaunch', () => {
    relaunchApp();
  });
  desktopIpc.handle('app-set-icon', (payload) => {
    return setAppIcon(payload?.mode);
  });
  desktopIpc.handle('open-external', ({ url }) => {
    return openExternal(url);
  });
}

module.exports = { registerAppPreferencesIpc };
