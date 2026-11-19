const {
  app,
  Menu,
  clipboard,
  dialog,
  ipcMain,
  MessageChannelMain,
  nativeImage,
  nativeTheme,
  powerMonitor,
  powerSaveBlocker,
  protocol,
  safeStorage,
  session,
  shell,
  webContents,
} = require('electron');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const githubVcs = require('./github.cjs');
const { createTerminalManager } = require('./terminal.cjs');
const { createTerminalSubscriptionRegistry } = require('./terminalPort.cjs');
const { createPerformanceMetricsCollector } = require('./performanceMetrics.cjs');
const { createNativeBrowserManager } = require('./nativeBrowser.cjs');
const { createNativeBrowserShortcuts } = require('./nativeBrowserShortcuts.cjs');
const { createNativeBrowserRequests } = require('./nativeBrowserRequests.cjs');
const { createPowerTier } = require('./powerTier.cjs');
const files = require('./files.cjs');
const localImages = require('./localImages.cjs');
const favicons = require('./favicons.cjs');
const canvasPreview = require('./canvasPreview.cjs');
const { createCanvasPreviewHosts } = require('./canvasPreviewHosts.cjs');
const {
  createCanvasImageImporter,
  createProjectImageRequests,
} = require('./canvasImageImport.cjs');
const { createCanvasImageSave } = require('./canvasImageSave.cjs');
const { createSidecarSupervisor } = require('./sidecar.cjs');
const { installAppQuit } = require('./appQuit.cjs');
const { installApplicationMenu } = require('./applicationMenu.cjs');
const { autoUpdater } = require('electron-updater');
const { createAppUpdater } = require('./appUpdater.cjs');
const Sentry = require('@sentry/electron/main');
const { createDiagnostics } = require('./diagnostics.cjs');
const { createUsageAnalytics } = require('./usageAnalytics.cjs');
const { createRemoteAccess } = require('./remoteAccess.cjs');
const { createDesktopIpc } = require('./desktopIpc.cjs');
const { createRemoteDesktop } = require('./remoteDesktop.cjs');
const { createProfileUsage } = require('./profileUsage.cjs');
const {
  preferenceFilePath: hardwareAccelerationPreferenceFilePath,
  readHardwareAccelerationPreferenceSync,
} = require('./hardwareAcceleration.cjs');
const { closeAllDesktopNotifications } = require('./notifications.cjs');
const {
  appRoot,
  sidecarEntry,
  canvasRuntimeDir,
  sidecarCwd,
  readBuildMetadata,
} = require('./appPaths.cjs');
const { createAppProtocols } = require('./appProtocols.cjs');
const { createWebContentsPolicy } = require('./webContentsPolicy.cjs');
const {
  createMainWindowController,
  getMainWindow,
  assertMainRenderer,
  focusMainWindow,
  isWindowUsable,
} = require('./mainWindow.cjs');
const { getAppIconMode, applyAppIcon } = require('./appIcon.cjs');
const { createNotificationActivation } = require('./notificationActivation.cjs');
const { registerNotificationIpc } = require('./notificationIpc.cjs');
const { registerRendererStorageIpc } = require('./rendererStorageIpc.cjs');
const { registerDiagnosticsIpc } = require('./diagnosticsIpc.cjs');
const { registerAppPreferencesIpc } = require('./appPreferencesIpc.cjs');
const { registerFilesIpc } = require('./filesIpc.cjs');
const { registerCanvasIpc } = require('./canvasIpc.cjs');
const { registerSourceControlIpc } = require('./sourceControlIpc.cjs');
const { registerTerminalIpc } = require('./terminalIpc.cjs');
const { registerBrowserIpc } = require('./browserIpc.cjs');

const APP_NAME = 'DROIDEX';
// An explicit profile override means a second dev instance is running beside
// the main one; its sidecar then gets an isolated history state dir so the two
// instances never fight over the history writer lease.
const configuredUserData = process.env.DROIDEX_USER_DATA_DIR;
const userDataOverride = configuredUserData?.trim() ? configuredUserData : undefined;
if (userDataOverride && !path.isAbsolute(userDataOverride)) {
  throw new Error('DROIDEX_USER_DATA_DIR must be an absolute path.');
}
// Dev builds all show in the Dock as the same "Electron" tile; the window title
// (listed in the tile's menu) and the Dock badge say which one this is.
const devInstance = app.isPackaged ? null : describeDevInstance();
// Set only by quit paths that know their cause; a Dock, menu or signal quit leaves it null.
let quitReason = null;
const buildMetadata = readBuildMetadata();
const terminalManager = createTerminalManager({
  defaultCwd: async () => {
    const chatCwd = path.join(app.getPath('userData'), 'chats');
    await fsp.mkdir(chatCwd, { recursive: true });
    return chatCwd;
  },
});
const terminalSubscriptions = createTerminalSubscriptionRegistry(terminalManager);
const desktopIpc = createDesktopIpc({ ipcMain, assertRenderer: assertMainRenderer });
const remoteDesktop = createRemoteDesktop({
  desktopIpc,
  MessageChannelMain,
  subscribeTerminal: (sender, id, port) => terminalSubscriptions.subscribe(sender, id, port),
});
const performanceMetrics = createPerformanceMetricsCollector({
  countPtys: () => terminalManager.count(),
  listWebContents: () => webContents.getAllWebContents(),
  nativeBrowserCounts: () => nativeBrowserManager.resourceCounts(),
  terminalCounts: () => terminalManager.resourceCounts(),
  powerTier: () => powerTier.current(),
  onSample: (metrics) => powerTier.noteRss(metrics.memory.rssBytes),
});
const filesRootAccess = files.createRootAccessRegistry();
const diagnostics = createDiagnostics({
  app,
  sentry: Sentry,
  dsn: buildMetadata.sentryDsn,
  logError: (message, error) => console.error('[diagnostics] %s:', message, error),
});
const usageAnalytics = createUsageAnalytics({
  app,
  config: buildMetadata.datadog,
  logError: (message, error) => console.error('[usage-analytics] %s:', message, error),
});
const sidecarSupervisor = createSidecarSupervisor({
  entryPath: sidecarEntry,
  canvasRuntimeDir,
  cwd: sidecarCwd,
  userData: () => app.getPath('userData'),
  historyDir: () => (userDataOverride ? path.join(userDataOverride, 'history') : undefined),
  onUnexpectedExit: (error) => diagnostics.captureException(error, { process: 'sidecar' }),
  onMessage: (message, reply, runEnded) => {
    if (!projectImageRequests(message, reply, runEnded))
      void nativeBrowserRequests.handle(message, reply, runEnded);
  },
});
const importCanvasImage = createCanvasImageImporter(nativeImage, sidecarSupervisor);
const projectImageRequests = createProjectImageRequests(importCanvasImage, sidecarSupervisor);
sidecarSupervisor.subscribe((status) => {
  const mainWindow = getMainWindow();
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('sidecar-status', status);
  }
  remoteDesktop.broadcast('sidecar-status', status);
});
const appUpdater = createAppUpdater({
  app,
  autoUpdater,
  installMode: buildMetadata.updateInstallMode,
  sparkleFeedUrl: buildMetadata.sparkleFeedUrl,
  sparkleUpdater: () => require('@droidex/sparkle-updater'),
  prepareToInstall: () => sidecarSupervisor.stop(),
  logError: (message, error) => console.error('[update] %s:', message, error),
});
const canvasPreviewHosts = createCanvasPreviewHosts({
  log: (message) => console.warn('[canvas-preview] %s', message),
  canCapture: () => powerMonitor.getSystemIdleState(1) !== 'locked',
});
const saveCanvasImage = createCanvasImageSave({
  dialog,
  fs: fsp,
  takeCapture: canvasPreviewHosts.takeCapture,
  getWindow: getMainWindow,
  sidecar: sidecarSupervisor,
});

const nativeBrowserShortcuts = createNativeBrowserShortcuts({ getMainWindow });
const nativeBrowserManager = createNativeBrowserManager({
  app,
  appName: APP_NAME,
  session,
  nativeImage,
  clipboard,
  dialog,
  safeStorage,
  getMainWindow,
  onBrowserInput: nativeBrowserShortcuts.handleInput,
  preloadPath: path.join(__dirname, 'nativeBrowserPreload.cjs'),
  getHostAppUrl: () => process.env.ELECTRON_START_URL || getMainWindow()?.webContents.getURL(),
  sendToRenderer: (channel, payload) => {
    if (isWindowUsable(getMainWindow())) getMainWindow().webContents.send(channel, payload);
  },
});
const { installWebviewAttachment, registerMediaPermissions } = createWebContentsPolicy({
  nativeBrowserManager,
  canvasPreviewHosts,
});
const nativeBrowserRequests = createNativeBrowserRequests({
  manager: nativeBrowserManager,
  notifyRenderer: (channel, payload) => {
    if (isWindowUsable(getMainWindow())) getMainWindow().webContents.send(channel, payload);
  },
});

const MEMORY_PRESSURE_RSS_BYTES = Number(
  process.env.DROID_MEMORY_PRESSURE_RSS_BYTES ?? 1.5 * 1024 * 1024 * 1024,
);
const powerTier = createPowerTier({
  powerMonitor,
  rssPressureBytes: MEMORY_PRESSURE_RSS_BYTES,
});

app.setName(APP_NAME);
// Must run before the app is ready: the renderer loads transcript images through
// this scheme, and Chromium only treats it as a normal, fetchable origin when it
// is declared up front.
protocol.registerSchemesAsPrivileged([
  {
    scheme: localImages.LOCAL_IMAGE_SCHEME,
    privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true },
  },
  // Site icons for links in the transcript (see favicons.cjs).
  {
    scheme: favicons.FAVICON_SCHEME,
    privileges: { standard: true, secure: true, supportFetchAPI: true },
  },
  // The trusted intermediate and its owned image/font subresources. Font
  // loading from an opaque srcdoc needs CORS, while connect-src still denies
  // generated fetches.
  {
    scheme: canvasPreview.CANVAS_PREVIEW_SCHEME,
    privileges: { standard: true, secure: true, corsEnabled: true },
  },
]);
// Overridable so a second dev instance (e.g. a feature worktree) can run beside
// the main one without fighting over the Chromium profile lock.
const userDataPath = userDataOverride || path.join(app.getPath('appData'), APP_NAME);
try {
  fs.mkdirSync(userDataPath, { recursive: true });
} catch (cause) {
  throw new Error(
    'Cannot create the DROIDEX profile directory. Check its permissions and ensure it is a directory, or set DROIDEX_USER_DATA_DIR to a writable absolute directory.',
    { cause },
  );
}
app.setPath('userData', userDataPath);
if (!app.isPackaged) {
  // Electron turns SIGTERM, SIGINT and SIGHUP into the same clean exit 0 as a
  // Dock or menu Quit; this makes it log "Handling shutdown for signal N" first.
  app.commandLine.appendSwitch('enable-logging');
  app.commandLine.appendSwitch('log-level', '2');
  app.commandLine.appendSwitch('vmodule', 'electron_browser_main_parts_posix=1');
}
// One app per profile. A second copy on the same profile, such as a dev build
// an agent launches without its own DROIDEX_USER_DATA_DIR, would boot a sidecar
// that reaps every agent process this one recorded.
if (!app.requestSingleInstanceLock()) {
  logExit('another instance already owns this profile');
  app.exit(0);
  return;
}
// Startup makes the first window; one made here before it would be a second.
app.on('second-instance', () => {
  if (getMainWindow()) focusMainWindow();
});
const hardwareAccelerationPreferencePath = hardwareAccelerationPreferenceFilePath(
  app.getPath('userData'),
);
if (
  !readHardwareAccelerationPreferenceSync({ filePath: hardwareAccelerationPreferencePath }).enabled
) {
  app.disableHardwareAcceleration();
}
// Before diagnostics writes into userData, or a new install looks like an old one.
const remoteAccess = createRemoteAccess({
  app,
  safeStorage,
  powerSaveBlocker,
  hostModule: path.join(
    app.isPackaged ? process.resourcesPath : appRoot(),
    'sidecar/dist/remoteHost.mjs',
  ),
  bridgeInfo: () => sidecarSupervisor.getBridgeInfo(),
  desktop: remoteDesktop,
  changed: (state) => {
    if (state.pending.length && !isWindowUsable(getMainWindow())) void openMainWindow();
    if (isWindowUsable(getMainWindow()))
      getMainWindow().webContents.send('remote-state-changed', state);
  },
});
const profileUsage = createProfileUsage({ bridgeInfo: () => sidecarSupervisor.getBridgeInfo() });

usageAnalytics.notePriorInstall();
const diagnosticsInitialization = diagnostics.initialize();
const { registerLocalImageProtocol, registerFaviconProtocol, registerCanvasPreviewProtocol } =
  createAppProtocols({ app, session, sidecarSupervisor, canvasPreviewHosts });
const notificationActivation = createNotificationActivation({ openMainWindow });
const { deliverPendingNotificationOpen } = notificationActivation;
const { createMainWindow, reloadFromMenu } = createMainWindowController({
  appName: APP_NAME,
  devInstance,
  installWebviewAttachment,
  deliverPendingNotificationOpen,
  reloadFocusedBrowser: nativeBrowserManager.reloadFocused,
  closeRendererOwnedTerminals: () => {
    terminalSubscriptions.clear();
    terminalManager.closeAll();
  },
  forgetBrowserWatchers: nativeBrowserManager.forgetWatchers,
  cleanupClosedWindow: () => {
    nativeBrowserManager.closeAll();
    terminalManager.closeAll();
    terminalSubscriptions.clear();
    filesRootAccess.clear();
    canvasPreviewHosts.clear();
  },
  attachPowerTier: powerTier.attachWindow,
});
// Startup and activation wait for the preview guest session's network to be off.
// An activation during startup waits here rather than racing a second window.
const previewSessionReady = app.whenReady().then(() => registerCanvasPreviewProtocol());

function openMainWindow() {
  return previewSessionReady.then(
    () => {
      if (!getMainWindow()) createMainWindow();
      else focusMainWindow();
    },
    (error) => {
      console.error('Canvas preview session setup failed; no window was opened:', error);
    },
  );
}

app.whenReady().then(async () => {
  await diagnosticsInitialization;
  installApplicationMenu({
    Menu,
    app,
    appName: APP_NAME,
    appUpdater,
    reload: reloadFromMenu,
    shell,
    logError: (message) => console.error('[menu] %s', message),
  });
  remoteAccess.registerIpc(desktopIpc);
  profileUsage.registerIpc(desktopIpc);
  sidecarSupervisor.registerIpc(desktopIpc);
  registerNotificationIpc({ desktopIpc, remoteAccess, notificationActivation });
  desktopIpc.handle('get-performance-metrics', () => {
    return performanceMetrics.collect();
  });
  desktopIpc.handle('system-idle-time', () => {
    return powerMonitor.getSystemIdleTime();
  });
  desktopIpc.handle('power-tier', () => {
    return powerTier.snapshot();
  });
  registerRendererStorageIpc({ desktopIpc, remoteDesktop });
  appUpdater.registerIpc(desktopIpc);
  registerDiagnosticsIpc({ desktopIpc, diagnostics });
  usageAnalytics.registerIpc(desktopIpc);
  registerAppPreferencesIpc({ desktopIpc, hardwareAccelerationPreferencePath, relaunchApp });
  registerFilesIpc({ desktopIpc, filesRootAccess });
  registerCanvasIpc({ sidecarSupervisor, importCanvasImage, canvasPreviewHosts, saveCanvasImage });
  registerSourceControlIpc({ desktopIpc });
  registerTerminalIpc({ desktopIpc, terminalManager, terminalSubscriptions });
  registerBrowserIpc({
    desktopIpc,
    nativeBrowserManager,
    nativeBrowserRequests,
    nativeBrowserShortcuts,
  });
  registerLocalImageProtocol();
  registerMediaPermissions();
  registerFaviconProtocol();
  await openMainWindow();
  powerTier.start();
  const metricsTimer = setInterval(() => performanceMetrics.collect(), 30_000);
  metricsTimer.unref?.();
  powerTier.onChange((tier) => {
    if (isWindowUsable(getMainWindow()))
      getMainWindow().webContents.send('power-tier', { ...powerTier.snapshot(), tier });
  });
  powerTier.onMemoryPressure(() => {
    terminalManager.trimReplay();
    if (isWindowUsable(getMainWindow()))
      getMainWindow().webContents.send('memory-pressure', { at: Date.now() });
  });
  // Pin the DROIDEX mark on the dock/taskbar up front so OS notifications
  // inherit it instead of the bare Electron atom in dev builds.
  applyAppIcon();
  if (devInstance && process.platform === 'darwin' && app.dock)
    app.dock.setBadge(devInstance.badge);
  // Repaint the icon when the OS appearance flips while 'system' is selected.
  nativeTheme.on('updated', () => {
    if (getAppIconMode() === 'system') applyAppIcon();
  });
  void sidecarSupervisor.start().catch((error) => console.error(error));
  void remoteAccess
    .resume()
    .catch(() =>
      console.error('[remote] Could not resume. Open Remote settings to review configuration.'),
    );
  // The relay socket rarely survives sleep, and it can look open long after.
  powerMonitor.on('resume', () => remoteAccess.reconnect());
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') quitReason = 'all windows closed';
});

installAppQuit({
  app,
  dialog,
  platform: process.platform,
  sidecar: sidecarSupervisor,
  getMainWindow: () => (isWindowUsable(getMainWindow()) ? getMainWindow() : null),
  openMainWindow,
  keepsSidecarWithoutWindows: () => remoteAccess.isEnabled(),
  closeServices: () => {
    logExit(quitReason ?? 'Quit from the app menu, the Dock, or a signal logged above');
    void remoteAccess.close().catch(() => console.error('[remote] Could not flush local state'));
    githubVcs.cancelSetup();
    closeAllDesktopNotifications();
    terminalManager.closeAll();
    terminalSubscriptions.clear();
    filesRootAccess.clear();
  },
  logError: (message, error) => console.error('[quit] %s:', message, error),
});

app.on('activate', () => {
  void openMainWindow().then(() => {
    deliverPendingNotificationOpen();
  });
  void sidecarSupervisor.start().catch((error) => console.error(error));
  void remoteAccess
    .resume()
    .catch(() =>
      console.error('[remote] Could not resume. Open Remote settings to review configuration.'),
    );
});

app.on('child-process-gone', (_event, details) => {
  const error = new Error(
    `Electron child process exited: type=${details.type} reason=${details.reason} exitCode=${details.exitCode}`,
  );
  console.error(error.message);
  diagnostics.captureException(error, { process: details.type, reason: details.reason });
});

function describeDevInstance() {
  const startUrl = process.env.ELECTRON_START_URL;
  const port = startUrl && URL.canParse(startUrl) ? new URL(startUrl).port : '';
  const profile = userDataOverride ? path.basename(userDataOverride) : '';
  if (!port && !profile) return null;
  const name = [port && `:${port}`, profile].filter(Boolean).join(' ');
  return { title: `${APP_NAME} dev ${name}`, badge: port || profile };
}

function logExit(reason) {
  console.warn(
    '[lifecycle] pid %d exiting after %ds: %s',
    process.pid,
    Math.round(process.uptime()),
    reason,
  );
}

function relaunchApp() {
  logExit('relaunch requested');
  app.relaunch();
  app.exit(0);
}
