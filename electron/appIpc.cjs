const { app, Notification, powerMonitor } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const { getMainWindow, isWindowUsable } = require('./mainWindow.cjs');
const { getAppIconMode, resolveAppIconFile, setAppIcon } = require('./appIcon.cjs');
const { showDesktopNotification } = require('./notifications.cjs');
const { isRemoteSender } = require('./remoteDesktop.cjs');
const { getApiKey, setApiKey } = require('./apiKeyStore.cjs');
const { getOnboarding, setOnboarding } = require('./onboardingStore.cjs');
const { openExternal } = require('./externalLinks.cjs');
const {
  loadHardwareAccelerationPreference,
  saveHardwareAccelerationPreference,
} = require('./hardwareAcceleration.cjs');
const fsp = require('node:fs/promises');

function registerAppIpc({
  desktopIpc,
  sidecarSupervisor,
  remoteAccess,
  remoteDesktop,
  performanceMetrics,
  powerTier,
  appUpdater,
  diagnostics,
  usageAnalytics,
  hardwareAccelerationPreferencePath,
  relaunchApp,
  notificationActivation,
}) {
  desktopIpc.handle('bridge-info', () => {
    return sidecarSupervisor.getBridgeInfo();
  });
  desktopIpc.handle('sidecar-status', () => {
    return sidecarSupervisor.snapshot();
  });
  // OS finish/status banners. silent=false plays the system notification sound.
  // Foreground suppress is owned by the renderer; click opens the finished
  // session via the pending-open queue.
  desktopIpc.handle('notify', (payload = {}, sender) => {
    const title =
      typeof payload.title === 'string' && payload.title.trim()
        ? payload.title.trim().slice(0, 120)
        : 'DROIDEX';
    const body = typeof payload.body === 'string' ? payload.body.trim().slice(0, 280) : '';
    const silent = payload.silent === true;
    const appSessionId =
      typeof payload.appSessionId === 'string' && payload.appSessionId.trim()
        ? payload.appSessionId.trim().slice(0, 200)
        : null;
    // Whatever needs the user at the laptop also needs them on a paired phone.
    if (!isRemoteSender(sender)) remoteAccess.notifyDevices();
    // Dock icon is applied on launch / icon settings; reuse that path for the banner.
    const iconPath = path.join(__dirname, 'assets', resolveAppIconFile(getAppIconMode()));
    return showDesktopNotification(Notification, {
      title,
      body,
      silent,
      ...(fs.existsSync(iconPath) ? { icon: iconPath } : {}),
      // Queue first so focus/show handlers can re-send if this IPC is dropped.
      onActivate: () => notificationActivation.queueNotificationSessionOpen(appSessionId),
    });
  });
  // Renderer acks after applying SET_ACTIVE_SESSION so we stop re-delivering.
  desktopIpc.handle('notification-activate-ack', (payload = {}) => {
    const appSessionId =
      typeof payload.appSessionId === 'string' ? payload.appSessionId.trim() : '';
    return notificationActivation.acknowledge(appSessionId);
  });
  // Pull path: renderer asks on focus/visibility in case the push event was lost.
  desktopIpc.handle('notification-take-pending', () => {
    return notificationActivation.takePendingNotificationOpen();
  });
  desktopIpc.handle('get-api-key', () => {
    return getApiKey();
  });
  desktopIpc.handle('set-api-key', ({ key }) => {
    return setApiKey(key);
  });
  desktopIpc.handle('get-performance-metrics', () => {
    return performanceMetrics.collect();
  });
  desktopIpc.handle('system-idle-time', () => {
    return powerMonitor.getSystemIdleTime();
  });
  desktopIpc.handle('power-tier', () => {
    return powerTier.snapshot();
  });
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
  desktopIpc.handle('onboarding-get', () => {
    return getOnboarding();
  });
  desktopIpc.handle('onboarding-set', ({ patch }) => {
    return setOnboarding(patch);
  });
  desktopIpc.handle('app-version', () => {
    return app.getVersion();
  });
  desktopIpc.handle('app-check-update', (options) => {
    return appUpdater.check(options);
  });
  desktopIpc.handle('app-download-update', () => {
    return appUpdater.downloadAndInstall();
  });
  desktopIpc.handle('feedback-report', async (report, sender) => {
    let screenshotPng = null;
    if (report?.attachments?.screenshot && sender && !sender.isDestroyed()) {
      try {
        const image = await Promise.race([
          sender.capturePage(),
          new Promise((_, reject) => setTimeout(() => reject(new Error('capture timeout')), 3_000)),
        ]);
        if (!image.isEmpty()) {
          const buffer = image.toPNG();
          if (buffer && buffer.length > 0 && buffer.length <= 500_000) {
            screenshotPng = buffer;
          }
        }
      } catch (error) {
        console.error('[feedback] screenshot capture skipped:', error?.message || error);
      }
    }
    return diagnostics.reportFeedback(report, { screenshotPng });
  });
  desktopIpc.handle('diagnostics-preference-get', () => {
    return diagnostics.automaticDiagnosticsPreference();
  });
  desktopIpc.handle('diagnostics-preference-set', async ({ enabled }) => {
    return diagnostics.setAutomaticDiagnosticsEnabled(enabled);
  });
  desktopIpc.handle('usage-analytics-bootstrap', () => {
    return usageAnalytics.bootstrap();
  });
  desktopIpc.handle('usage-analytics-first-launch-reported', () => {
    return usageAnalytics.markFirstLaunchReported();
  });
  desktopIpc.handle('usage-analytics-preference-get', () => {
    return usageAnalytics.preference();
  });
  desktopIpc.handle('usage-analytics-preference-set', async ({ enabled }) => {
    return usageAnalytics.setEnabled(enabled);
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

module.exports = { registerAppIpc };
