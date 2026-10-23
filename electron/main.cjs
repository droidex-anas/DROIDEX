const {
  app,
  BrowserWindow,
  Menu,
  clipboard,
  Notification,
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
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const gitVcs = require('./git.cjs');
const { expandHome } = gitVcs;
const githubVcs = require('./github.cjs');
const githubPrConversation = require('./githubPrConversation.cjs');
const { createTerminalManager } = require('./terminal.cjs');
const { createTerminalSubscriptionRegistry } = require('./terminalPort.cjs');
const { createPerformanceMetricsCollector } = require('./performanceMetrics.cjs');
const { createNativeBrowserManager } = require('./nativeBrowser.cjs');
const { createNativeBrowserShortcuts } = require('./nativeBrowserShortcuts.cjs');
const { createNativeBrowserRequests } = require('./nativeBrowserRequests.cjs');
const { createPowerTier } = require('./powerTier.cjs');
const files = require('./files.cjs');
const attachments = require('./attachments.cjs');
const imageSave = require('./imageSave.cjs');
const localImages = require('./localImages.cjs');
const favicons = require('./favicons.cjs');
const editorApps = require('./editorApps.cjs');
const { openProject } = require('./projectLauncher.cjs');
const { createSidecarSupervisor } = require('./sidecar.cjs');
const { installRendererNavigationGuard } = require('./rendererSecurity.cjs');
const { installApplicationMenu } = require('./applicationMenu.cjs');
const { installContextMenu } = require('./contextMenu.cjs');
const { createRendererOomRecovery, isRendererMemoryExit } = require('./rendererOomRecovery.cjs');
const { autoUpdater } = require('electron-updater');
const { createAppUpdater } = require('./appUpdater.cjs');
const Sentry = require('@sentry/electron/main');
const { createDiagnostics } = require('./diagnostics.cjs');
const { createUsageAnalytics } = require('./usageAnalytics.cjs');
const { createRemoteAccess } = require('./remoteAccess.cjs');
const { createDesktopIpc } = require('./desktopIpc.cjs');
const { createRemoteDesktop, isRemoteSender } = require('./remoteDesktop.cjs');
const { createProfileUsage } = require('./profileUsage.cjs');
const {
  preferenceFilePath: hardwareAccelerationPreferenceFilePath,
  readHardwareAccelerationPreferenceSync,
  loadHardwareAccelerationPreference,
  saveHardwareAccelerationPreference,
} = require('./hardwareAcceleration.cjs');
const { closeAllDesktopNotifications, showDesktopNotification } = require('./notifications.cjs');
const APP_NAME = 'DROIDEX';
// An explicit profile override means a second dev instance is running beside
// the main one; its sidecar then gets an isolated history state dir so the two
// instances never fight over the history writer lease.
const configuredUserData = process.env.DROIDEX_USER_DATA_DIR;
const userDataOverride = configuredUserData?.trim() ? configuredUserData : undefined;
if (userDataOverride && !path.isAbsolute(userDataOverride)) {
  throw new Error('DROIDEX_USER_DATA_DIR must be an absolute path.');
}
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
  cwd: () => (app.isPackaged ? process.resourcesPath : appRoot()),
  userData: () => app.getPath('userData'),
  historyDir: () => (userDataOverride ? path.join(userDataOverride, 'history') : undefined),
  onUnexpectedExit: (error) => diagnostics.captureException(error, { process: 'sidecar' }),
  onMessage: (message, reply, runEnded) =>
    void nativeBrowserRequests.handle(message, reply, runEnded),
});
// subscribe() replays the current status synchronously, so mainWindow must
// already be initialized when this runs.
let mainWindow = null;
sidecarSupervisor.subscribe((status) => {
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
const rendererOomRecovery = createRendererOomRecovery();

// Selected app-icon appearance. 'system' tracks the OS light/dark setting via
// nativeTheme; 'light'/'dark' pin a specific artwork.
let appIconMode = 'system';
// Session to open after a finish-notification click. macOS often focuses the
// app before (or without) delivering the Notification `click` payload cleanly,
// so we queue the target and re-deliver on focus until the renderer acks.
/** @type {{ appSessionId: string, expiresAt: number } | null } */
let pendingNotificationOpen = null;
const PENDING_NOTIFICATION_OPEN_MS = 30_000;
const nativeBrowserShortcuts = createNativeBrowserShortcuts({ getMainWindow: () => mainWindow });
const nativeBrowserManager = createNativeBrowserManager({
  app,
  appName: APP_NAME,
  session,
  nativeImage,
  dialog,
  safeStorage,
  getMainWindow: () => mainWindow,
  onBrowserInput: nativeBrowserShortcuts.handleInput,
  preloadPath: path.join(__dirname, 'nativeBrowserPreload.cjs'),
  getHostAppUrl: () => process.env.ELECTRON_START_URL || mainWindow?.webContents.getURL(),
  sendToRenderer: (channel, payload) => {
    if (isWindowUsable(mainWindow)) mainWindow.webContents.send(channel, payload);
  },
});
// Claims each <webview> guest for the session main reserved it for, in the
// same dispatch that creates it.
app.on('web-contents-created', (_event, contents) => nativeBrowserManager.handleCreated(contents));
const nativeBrowserRequests = createNativeBrowserRequests({
  manager: nativeBrowserManager,
  notifyRenderer: (channel, payload) => {
    if (isWindowUsable(mainWindow)) mainWindow.webContents.send(channel, payload);
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
// One app per profile. A second copy on the same profile, such as a dev build
// an agent launches without its own DROIDEX_USER_DATA_DIR, would boot a sidecar
// that reaps every agent process this one recorded.
if (!app.requestSingleInstanceLock()) {
  app.exit(0);
  return;
}
// Startup makes the first window; one made here before it would be a second.
app.on('second-instance', () => {
  if (mainWindow) focusMainWindow();
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
    if (state.pending.length && !isWindowUsable(mainWindow)) createMainWindow();
    if (isWindowUsable(mainWindow)) mainWindow.webContents.send('remote-state-changed', state);
  },
});
const profileUsage = createProfileUsage({ bridgeInfo: () => sidecarSupervisor.getBridgeInfo() });

usageAnalytics.notePriorInstall();
const diagnosticsInitialization = diagnostics.initialize();
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
  registerIpc();
  registerLocalImageProtocol();
  registerMediaPermissions();
  registerFaviconProtocol();
  createMainWindow();
  powerTier.start();
  const metricsTimer = setInterval(() => performanceMetrics.collect(), 30_000);
  metricsTimer.unref?.();
  powerTier.onChange((tier) => {
    if (isWindowUsable(mainWindow))
      mainWindow.webContents.send('power-tier', { ...powerTier.snapshot(), tier });
  });
  powerTier.onMemoryPressure(() => {
    terminalManager.trimReplay();
    if (isWindowUsable(mainWindow))
      mainWindow.webContents.send('memory-pressure', { at: Date.now() });
  });
  // Pin the DROIDEX mark on the dock/taskbar up front so OS notifications
  // inherit it instead of the bare Electron atom in dev builds.
  applyAppIcon();
  // Repaint the icon when the OS appearance flips while 'system' is selected.
  nativeTheme.on('updated', () => {
    if (appIconMode === 'system') applyAppIcon();
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
  if (!remoteAccess.isEnabled()) sidecarSupervisor.stop();
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', () => {
  void remoteAccess.close().catch(() => console.error('[remote] Could not flush local state'));
  sidecarSupervisor.stop();
  githubVcs.cancelSetup();
  closeAllDesktopNotifications();
  terminalManager.closeAll();
  terminalSubscriptions.clear();
  filesRootAccess.clear();
});

app.on('activate', () => {
  if (!mainWindow) createMainWindow();
  else focusMainWindow();
  void sidecarSupervisor.start().catch((error) => console.error(error));
  void remoteAccess
    .resume()
    .catch(() =>
      console.error('[remote] Could not resume. Open Remote settings to review configuration.'),
    );
  deliverPendingNotificationOpen();
});

app.on('child-process-gone', (_event, details) => {
  const error = new Error(
    `Electron child process exited: type=${details.type} reason=${details.reason} exitCode=${details.exitCode}`,
  );
  console.error(error.message);
  diagnostics.captureException(error, { process: details.type, reason: details.reason });
});

function createMainWindow() {
  const devStartUrl = app.isPackaged ? undefined : process.env.ELECTRON_START_URL;
  const rendererFile = path.join(appRoot(), 'dist/index.html');
  const rendererEntryUrl = devStartUrl || pathToFileURL(rendererFile).toString();
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1000,
    minHeight: 600,
    title: APP_NAME,
    icon: path.join(__dirname, 'assets', process.platform === 'darwin' ? 'icon.icns' : 'icon.png'),
    backgroundColor: process.platform === 'darwin' ? '#00000000' : '#0a0a0a',
    vibrancy: process.platform === 'darwin' ? 'under-window' : undefined,
    visualEffectState: 'active',
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    trafficLightPosition: { x: 14, y: 12 },
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      // Browser pages are <webview> guests; only guests main reserved attach.
      webviewTag: true,
    },
  });
  mainWindow.webContents.on('will-attach-webview', (event, webPreferences, params) =>
    nativeBrowserManager.handleWillAttach(event, webPreferences, params, mainWindow.webContents),
  );
  mainWindow.webContents.on('did-attach-webview', (_event, contents) =>
    nativeBrowserManager.handleAttached(contents),
  );

  installRendererNavigationGuard(mainWindow.webContents, rendererEntryUrl, (url) =>
    shell.openExternal(url),
  );
  installMainRendererLifecycle(mainWindow.webContents);
  installContextMenu({
    Menu,
    clipboard,
    openExternal,
    window: mainWindow,
    webContents: mainWindow.webContents,
    logError: (message) => console.error('[context-menu] %s', message),
  });

  if (devStartUrl) mainWindow.loadURL(devStartUrl);
  else mainWindow.loadFile(rendererFile);

  // Re-deliver a queued notification open once the window is actually frontmost
  // and the renderer can receive IPC (critical when coming back from Safari).
  mainWindow.on('focus', () => {
    deliverPendingNotificationOpen();
  });
  mainWindow.on('show', () => {
    deliverPendingNotificationOpen();
  });
  mainWindow.webContents.on('did-finish-load', () => {
    deliverPendingNotificationOpen();
  });

  mainWindow.on('closed', () => {
    rendererOomRecovery.cancel();
    githubVcs.cancelSetup();
    nativeBrowserManager.closeAll();
    terminalManager.closeAll();
    terminalSubscriptions.clear();
    filesRootAccess.clear();
    mainWindow = null;
  });
  powerTier.attachWindow(mainWindow);
}

// Voice mode records only while the user holds a conversation open, and only
// the app's own window may ask. Every other permission stays denied, and the
// Browser pane's partition is untouched, so a web page there cannot reach the
// microphone.
// The app had no permission handler until voice needed the microphone, so
// everything a page asked for was granted by default. Adding one closes that,
// which means the app's own needs have to be named here: the microphone for a
// voice conversation, the clipboard for copy and paste, and notifications for
// a finished turn. Everything else is refused, and so is every window that is
// not the app's own, including the pages the embedded browser loads.
const WINDOW_PERMISSIONS = new Set([
  'clipboard-read',
  'clipboard-sanitized-write',
  'notifications',
]);

function registerMediaPermissions() {
  const isOwnWindow = (contents) =>
    mainWindow !== null && !mainWindow.isDestroyed() && contents === mainWindow.webContents;
  // An empty list is not audio: legacy capture requests arrive with no types
  // and can still end up with a video device once approved.
  const isAudioOnly = (types) =>
    Array.isArray(types) && types.length > 0 && types.every((type) => type === 'audio');
  session.defaultSession.setPermissionRequestHandler((contents, permission, callback, details) => {
    if (!isOwnWindow(contents)) {
      callback(false);
      return;
    }
    if (permission === 'audioCapture') {
      callback(true);
      return;
    }
    if (permission === 'media') {
      callback(isAudioOnly(details?.mediaTypes));
      return;
    }
    callback(WINDOW_PERMISSIONS.has(permission));
  });
  session.defaultSession.setPermissionCheckHandler((contents, permission, _origin, details) => {
    if (contents === null || !isOwnWindow(contents)) return false;
    if (permission === 'audioCapture') return true;
    if (permission === 'media') return details?.mediaType === 'audio';
    return WINDOW_PERMISSIONS.has(permission);
  });
}

// Serves local image files to the renderer (see localImages.cjs). Registered on
// the default session only: the Browser pane runs in its own partition, so web
// pages there never gain a local-file reader.
function registerLocalImageProtocol() {
  session.defaultSession.protocol.handle(localImages.LOCAL_IMAGE_SCHEME, async (request) => {
    try {
      const filePath = localImages.localImageRequestPath(request.url);
      const { mime, data } = await localImages.readLocalImage(filePath);
      // no-store: an attachment path can be rewritten in place by a crop, and a
      // cached body would keep showing the superseded pixels.
      // The scheme is fetchable and serves image/svg+xml, so the response denies
      // every subresource and script: an SVG is inert in an <img>, but this keeps
      // it inert if a body is ever navigated to or embedded directly. nosniff
      // stops Chromium from re-typing a body as something executable.
      return new Response(data, {
        headers: {
          'content-type': mime,
          'cache-control': 'no-store',
          'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'",
          'x-content-type-options': 'nosniff',
        },
      });
    } catch (error) {
      // The renderer degrades to an "image unavailable" chip; the reason is only
      // useful when debugging, so keep it out of the UI and in the log.
      console.warn('Could not serve local image %s:', request.url, error);
      return new Response('Image unavailable', { status: 404 });
    }
  });
}

// Serves site icons for transcript links (see favicons.cjs). Default session
// only, like local images: pages in the Browser pane cannot use the app to
// fetch on their behalf.
function registerFaviconProtocol() {
  const store = favicons.createFaviconStore({
    cacheDir: path.join(app.getPath('userData'), 'favicons'),
    userAgent: session.defaultSession.getUserAgent(),
    logError: (message) => console.warn('[favicon] %s', message),
  });
  session.defaultSession.protocol.handle(favicons.FAVICON_SCHEME, async (request) => {
    try {
      const icon = await store.load(favicons.faviconRequestTarget(request.url));
      if (!icon) return new Response('No icon', { status: 404 });
      // The same inert-body headers as local images: a third-party SVG stays an
      // image even if something navigates to it directly.
      return new Response(icon.data, {
        headers: {
          'content-type': icon.mime,
          'cache-control': 'max-age=86400',
          'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'",
          'x-content-type-options': 'nosniff',
        },
      });
    } catch {
      console.warn('Could not serve icon: invalid request or unavailable image');
      return new Response('Icon unavailable', { status: 404 });
    }
  });
}

function registerIpc() {
  desktopIpc.handle('bridge-info', () => {
    return sidecarSupervisor.getBridgeInfo();
  });
  desktopIpc.handle('sidecar-status', () => {
    return sidecarSupervisor.snapshot();
  });
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
    const iconPath = path.join(__dirname, 'assets', resolveAppIconFile(appIconMode));
    return showDesktopNotification(Notification, {
      title,
      body,
      silent,
      ...(fs.existsSync(iconPath) ? { icon: iconPath } : {}),
      // Queue first so focus/show handlers can re-send if this IPC is dropped.
      onActivate: () => queueNotificationSessionOpen(appSessionId),
    });
  });
  // Renderer acks after applying SET_ACTIVE_SESSION so we stop re-delivering.
  desktopIpc.handle('notification-activate-ack', (payload = {}) => {
    const appSessionId =
      typeof payload.appSessionId === 'string' ? payload.appSessionId.trim() : '';
    if (
      pendingNotificationOpen &&
      (!appSessionId || pendingNotificationOpen.appSessionId === appSessionId)
    ) {
      pendingNotificationOpen = null;
    }
    return { ok: true };
  });
  // Pull path: renderer asks on focus/visibility in case the push event was lost.
  desktopIpc.handle('notification-take-pending', () => {
    return takePendingNotificationOpen();
  });
  desktopIpc.handle('get-api-key', () => {
    return getApiKey();
  });
  desktopIpc.handle('set-api-key', ({ key }) => {
    return setApiKey(key);
  });
  desktopIpc.handle('list-files', ({ dir }) => {
    return listFiles(dir);
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
  desktopIpc.handle('read-file', ({ path: filePath }) => {
    return readFile(filePath);
  });
  // A Remote browser cannot load droidex-img URLs, so it asks for the bytes.
  // The tunnel is far slower than the protocol handler, hence the lower cap.
  desktopIpc.handle('local-image-read', ({ url }) => {
    const filePath = localImages.localImageRequestPath(url);
    return localImages.readLocalImage(filePath, { maxBytes: 8 * 1024 * 1024 });
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
    if (!isWindowUsable(mainWindow)) throw new Error('Open the DROIDEX window on your laptop');
    return mainWindow.webContents.executeJavaScript(
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
    if (isWindowUsable(mainWindow) && mainWindow.webContents !== sender) {
      mainWindow.webContents.send('shared-storage-changed', change);
    }
    remoteDesktop.broadcast('shared-storage-changed', change, sender);
  });
  desktopIpc.handle('repo-status', ({ dir }) => {
    return gitVcs.repoStatus(dir);
  });
  desktopIpc.handle('list-editors', () => {
    return editorApps.listEditors();
  });
  desktopIpc.handle('editor-icon', ({ editor }) => {
    return editorApps.editorIcon(editor);
  });
  desktopIpc.handle('open-project', ({ dir, editor, target }) => {
    return openProject(dir, editor, target);
  });

  desktopIpc.handle('git-environment', ({ dir }) => {
    return gitVcs.environment(dir);
  });
  desktopIpc.handle('git-branches', ({ dir }) => {
    return gitVcs.branches(dir);
  });
  desktopIpc.handle('git-worktrees', ({ dir }) => {
    return gitVcs.worktrees(dir);
  });
  desktopIpc.handle('git-diff-stat', ({ dir, options }) => {
    return gitVcs.diffStat(dir, options);
  });
  desktopIpc.handle('git-diff-files', ({ dir, options }) => {
    return gitVcs.diffFiles(dir, options);
  });
  desktopIpc.handle('git-file-diff', ({ dir, options }) => {
    return gitVcs.fileDiff(dir, options);
  });
  desktopIpc.handle('git-mark-turn-start', ({ dir, ownerId }) => {
    return gitVcs.markTurnStart(dir, ownerId);
  });
  desktopIpc.handle('git-adopt-turn-baseline', ({ dir, clientRef, appSessionId }) => {
    return gitVcs.adoptTurnBaseline(dir, clientRef, appSessionId);
  });
  desktopIpc.handle('git-create-branch', ({ dir, options }) => {
    return gitVcs.createBranch(dir, options);
  });
  desktopIpc.handle('git-checkout', ({ dir, options }) => {
    return gitVcs.checkout(dir, options);
  });
  desktopIpc.handle('git-create-worktree', ({ dir, options }) => {
    return gitVcs.createWorktree(dir, options);
  });
  desktopIpc.handle('git-remove-worktree', ({ dir, options }) => {
    return gitVcs.removeWorktree(dir, options);
  });
  desktopIpc.handle('git-commit', ({ dir, options }) => {
    return gitVcs.commit(dir, options);
  });
  desktopIpc.handle('git-push', ({ dir, options }) => {
    return gitVcs.push(dir, options);
  });
  desktopIpc.handle('git-fetch', ({ dir }) => {
    return gitVcs.fetchRemotes(dir);
  });

  desktopIpc.handle('github-available', () => {
    return githubVcs.available();
  });
  desktopIpc.handle('github-install', () => {
    return githubVcs.install();
  });
  desktopIpc.handle('github-authenticate', (_payload, sender) => {
    return githubVcs.authenticate({
      onDeviceCode: (code) => {
        if (!sender.isDestroyed()) sender.send('github-auth-code', { code });
      },
    });
  });
  desktopIpc.handle('github-cancel-setup', () => {
    githubVcs.cancelSetup();
    return { ok: true };
  });
  desktopIpc.handle('github-detect-pr', (payload = {}) => {
    const { dir, options } = payload || {};
    const requestDir = prWorkspaceRequestDir(dir);
    if (!requestDir) return { ok: false, pr: null };
    return githubVcs.detectPr(requestDir, options);
  });
  desktopIpc.handle('github-list-prs', (payload = {}) => {
    const { dir, options } = payload || {};
    const requestDir = prWorkspaceRequestDir(dir);
    if (!requestDir) return { ok: false, reason: 'invalid', viewerLogin: null, prs: [] };
    return githubVcs.listPrs(requestDir, options);
  });
  desktopIpc.handle('github-view-pr', (payload = {}) => {
    const { dir, options } = payload || {};
    const requestDir = prWorkspaceRequestDir(dir);
    if (!requestDir) return { ok: false, reason: 'invalid', pr: null };
    return githubVcs.viewPr(requestDir, options);
  });
  desktopIpc.handle('github-pr-diff', (payload = {}) => {
    const { dir, options } = payload || {};
    const requestDir = prWorkspaceRequestDir(dir);
    if (!requestDir) return { ok: false, reason: 'invalid', diff: '' };
    return githubVcs.prDiff(requestDir, options);
  });
  desktopIpc.handle('github-pr-checks', (payload = {}) => {
    const { dir, options } = payload || {};
    const requestDir = prWorkspaceRequestDir(dir);
    if (!requestDir) return { ok: false, reason: 'invalid', checks: [] };
    return githubVcs.prChecks(requestDir, options);
  });
  desktopIpc.handle('github-pr-comments', (payload = {}) => {
    const { dir, options } = payload || {};
    const requestDir = prWorkspaceRequestDir(dir);
    if (!requestDir) return { ok: false, reason: 'invalid', comments: [] };
    return githubPrConversation.prComments(requestDir, options);
  });
  desktopIpc.handle('github-create-pr', (payload = {}) => {
    const { dir, options } = payload || {};
    const requestDir = prWorkspaceRequestDir(dir);
    if (!requestDir) return { ok: false, reason: 'invalid' };
    return githubVcs.createPr(requestDir, options);
  });
  desktopIpc.handle('github-post-comment', (payload = {}) => {
    const { dir, options } = payload || {};
    const requestDir = prWorkspaceRequestDir(dir);
    if (!requestDir) return { ok: false, reason: 'invalid' };
    return githubVcs.postComment(requestDir, options);
  });
  desktopIpc.handle('github-merge-pr', (payload = {}) => {
    const { dir, options } = payload || {};
    const requestDir = prWorkspaceRequestDir(dir);
    if (!requestDir) return { ok: false, reason: 'invalid' };
    return githubVcs.mergePr(requestDir, options);
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

  desktopIpc.handle('terminal-create', (args) => {
    return terminalManager.create({
      appSessionId: args?.appSessionId,
      cwd: args?.cwd,
      cols: args?.cols,
      rows: args?.rows,
    });
  });
  desktopIpc.handle('terminal-resize', ({ id, cols, rows }) => {
    terminalManager.resize(id, cols, rows);
  });
  desktopIpc.handle('terminal-kill', ({ id }, sender) => {
    terminalSubscriptions.unsubscribe(sender, id);
    terminalManager.kill(id);
  });
  desktopIpc.handle('terminal-has-children', ({ id }) => {
    return terminalManager.hasChildren(id);
  });
  desktopIpc.handle('terminal-list', (filter) => {
    return terminalManager.list({ appSessionId: filter?.appSessionId });
  });
  ipcMain.on('terminal-subscribe', (event, payload) => {
    const port = event.ports?.[0];
    try {
      assertMainRenderer(event);
      const id = payload?.id;
      if (typeof id !== 'string' || id.length === 0) {
        throw new Error('terminal-subscribe requires an id');
      }
      if (!port) throw new Error('terminal-subscribe requires a MessagePort');
      terminalSubscriptions.subscribe(event.sender, id, port);
    } catch (error) {
      if (port) {
        try {
          port.postMessage({
            kind: 'error',
            message: error instanceof Error ? error.message : String(error),
          });
        } catch {
          // port already closed
        }
        try {
          port.close();
        } catch {
          // already closed
        }
      }
    }
  });
  desktopIpc.handle('terminal-unsubscribe', ({ id }, sender) => {
    terminalSubscriptions.unsubscribe(sender, id);
  });
  desktopIpc.handle('files-authorize-root', async ({ root }, sender) => {
    const authorized = await filesRootAccess.tokenFor(root);
    if (authorized) return authorized;
    // A paired browser already has a shell on this account, and nobody may be at
    // the laptop to answer a dialog.
    if (isRemoteSender(sender)) return filesRootAccess.authorize(root);
    const expectedRoot = await files.canonicalDirectory(root);
    const result = await dialog.showOpenDialog(mainWindow, {
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

  desktopIpc.handle('native-browser-reserve', ({ browserSessionId, savedUrl, savedMode }) => {
    return nativeBrowserManager.reserve(
      browserSessionId,
      mainWindow.webContents,
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
      mainWindow?.webContents.send('native-browser-design-event', { ...next, browserSessionId });
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

function assertMainRenderer(event) {
  if (
    !mainWindow ||
    event.sender !== mainWindow.webContents ||
    event.senderFrame !== mainWindow.webContents.mainFrame
  ) {
    throw new Error('Desktop request rejected for unknown renderer.');
  }
}

function prWorkspaceRequestDir(value) {
  if (typeof value !== 'string') return null;
  return value.trim() ? value : null;
}

function resolveAppIconFile(mode) {
  const useDark = mode === 'dark' || (mode === 'system' && nativeTheme.shouldUseDarkColors);
  return useDark ? 'icon-dark.png' : 'icon.png';
}

function applyAppIcon() {
  const iconPath = path.join(__dirname, 'assets', resolveAppIconFile(appIconMode));
  if (!fs.existsSync(iconPath)) return;
  if (process.platform === 'darwin' && app.dock) {
    app.dock.setIcon(iconPath);
  }
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.setIcon(iconPath);
  }
}

function focusMainWindow() {
  if (!mainWindow || mainWindow.isDestroyed()) {
    createMainWindow();
  }
  if (!mainWindow || mainWindow.isDestroyed()) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
  if (process.platform === 'darwin' && app.dock) app.dock.bounce('informational');
}

function queueNotificationSessionOpen(appSessionId) {
  if (!appSessionId) {
    focusMainWindow();
    return;
  }
  pendingNotificationOpen = {
    appSessionId,
    expiresAt: Date.now() + PENDING_NOTIFICATION_OPEN_MS,
  };
  focusMainWindow();
  // Immediate attempt; focus/show/did-finish-load will retry until ack.
  deliverPendingNotificationOpen();
}

function pendingNotificationPayload() {
  if (!pendingNotificationOpen) return null;
  if (Date.now() > pendingNotificationOpen.expiresAt) {
    pendingNotificationOpen = null;
    return null;
  }
  return { appSessionId: pendingNotificationOpen.appSessionId };
}

function deliverPendingNotificationOpen() {
  const payload = pendingNotificationPayload();
  if (!payload || !isWindowUsable(mainWindow)) return;
  mainWindow.webContents.send('notification-activate', payload);
}

/** Return and clear the pending open (renderer pull on focus). */
function takePendingNotificationOpen() {
  const payload = pendingNotificationPayload();
  pendingNotificationOpen = null;
  return payload;
}

function setAppIcon(mode) {
  if (mode !== 'light' && mode !== 'dark' && mode !== 'system') {
    throw new Error('App icon mode must be light, dark, or system.');
  }
  appIconMode = mode;
  applyAppIcon();
  return mode;
}

// With a browser page focused, Reload from the menu means that page;
// reloading the shell would destroy every mounted page.
function reloadFromMenu(ignoreCache) {
  if (!ignoreCache && nativeBrowserManager.reloadFocused(webContents.getFocusedWebContents()))
    return;
  reloadShell(ignoreCache);
}

function reloadShell(ignoreCache) {
  if (!isWindowUsable(mainWindow)) return;
  closeRendererOwnedTerminals();
  if (ignoreCache) mainWindow.webContents.reloadIgnoringCache();
  else mainWindow.webContents.reload();
}

function installMainRendererLifecycle(contents) {
  let hasLoadedMainFrame = false;
  let cleanedForNavigation = false;

  const cleanupForRendererReplacement = () => {
    if (!hasLoadedMainFrame || cleanedForNavigation) return;
    cleanedForNavigation = true;
    githubVcs.cancelSetup();
    closeRendererOwnedTerminals();
    nativeBrowserManager.forgetWatchers();
  };

  contents.on('did-finish-load', () => {
    hasLoadedMainFrame = true;
    cleanedForNavigation = false;
  });
  contents.on('will-frame-navigate', (_event, _url, isInPlace, isMainFrame) => {
    if (isMainFrame && !isInPlace) {
      rendererOomRecovery.cancel();
      cleanupForRendererReplacement();
    }
  });
  contents.on('did-start-navigation', (_event, _url, isInPlace, isMainFrame) => {
    if (isMainFrame && !isInPlace) {
      rendererOomRecovery.cancel();
      cleanupForRendererReplacement();
    }
  });
  contents.on('render-process-gone', cleanupForRendererReplacement);
  contents.on('render-process-gone', (_event, details) => {
    const scheduled = rendererOomRecovery.handle(details, () => {
      if (!isWindowUsable(mainWindow) || mainWindow.webContents !== contents) return;
      console.error('[renderer] Reloading after renderer OOM');
      reloadShell(false);
    });
    if (isRendererMemoryExit(details) && !scheduled) {
      console.error('[renderer] Automatic OOM recovery stopped to avoid a reload crash loop');
    }
  });
}

function closeRendererOwnedTerminals() {
  terminalSubscriptions.clear();
  terminalManager.closeAll();
}

function appRoot() {
  // Packaged app files (renderer dist, electron/) live inside app.asar, which
  // Electron resolves transparently for loadFile/loadURL.
  return app.isPackaged
    ? path.join(process.resourcesPath, 'app.asar')
    : path.resolve(__dirname, '..');
}

function sidecarEntry() {
  // The sidecar ships as an extraResource beside the asar so it can be spawned
  // as a plain Node script; an asar path would not survive as a child cwd/argv.
  if (!app.isPackaged && process.env.SIDECAR_ENTRY) return process.env.SIDECAR_ENTRY;
  return app.isPackaged
    ? path.join(process.resourcesPath, 'sidecar/dist/sidecar.mjs')
    : path.join(appRoot(), 'sidecar/dist/sidecar.mjs');
}

function readBuildMetadata() {
  if (!app.isPackaged) {
    return {
      sentryDsn: process.env.SENTRY_DSN || '',
      sparkleFeedUrl: process.env.SPARKLE_FEED_URL || '',
      updateInstallMode: 'sparkle',
      datadog: readDatadogMetadata(process.env),
    };
  }
  try {
    const metadata = require(path.join(app.getAppPath(), 'package.json'));
    return {
      sentryDsn: typeof metadata.sentryDsn === 'string' ? metadata.sentryDsn : '',
      sparkleFeedUrl: typeof metadata.sparkleFeedUrl === 'string' ? metadata.sparkleFeedUrl : '',
      updateInstallMode: metadata.updateInstallMode === 'automatic' ? 'automatic' : 'sparkle',
      datadog: readDatadogMetadata(metadata.datadog || {}),
    };
  } catch {
    return {
      sentryDsn: '',
      sparkleFeedUrl: '',
      updateInstallMode: 'sparkle',
      datadog: readDatadogMetadata({}),
    };
  }
}

// Datadog RUM ships an application id and a *client* token. Both are meant to
// be public in a client build; the Datadog API key is a CI-only secret and is
// never read here or embedded in the app.
function readDatadogMetadata(source) {
  const read = (key) => (typeof source[key] === 'string' ? source[key].trim() : '');
  return {
    applicationId: read('DATADOG_APPLICATION_ID') || read('applicationId'),
    clientToken: read('DATADOG_CLIENT_TOKEN') || read('clientToken'),
    site: read('DATADOG_SITE') || read('site'),
    distributionChannel:
      read('DROIDEX_DISTRIBUTION_CHANNEL') || read('distributionChannel') || 'local',
  };
}

function isWindowUsable(window) {
  return Boolean(window && !window.isDestroyed());
}

async function getApiKey() {
  try {
    const encrypted = await fsp.readFile(apiKeyPath());
    return safeStorage.decryptString(encrypted);
  } catch (err) {
    if (err && err.code === 'ENOENT') return null;
    throw err;
  }
}

async function setApiKey(key) {
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error('Electron safeStorage encryption is not available on this system.');
  }
  await fsp.mkdir(path.dirname(apiKeyPath()), { recursive: true });
  await fsp.writeFile(apiKeyPath(), safeStorage.encryptString(key));
}

function apiKeyPath() {
  return path.join(app.getPath('userData'), 'factory-api-key.bin');
}

// ── Onboarding state ────────────────────────────────────────────────
// Kept in userData (not localStorage) so the first-run tour survives a cache
// clear and only ever shows once.
const ONBOARDING_VERSION = 1;

function onboardingPath() {
  return path.join(app.getPath('userData'), 'onboarding.json');
}

async function getOnboarding() {
  try {
    const raw = await fsp.readFile(onboardingPath(), 'utf8');
    const parsed = JSON.parse(raw);
    return { completed: false, version: ONBOARDING_VERSION, ...parsed };
  } catch {
    return { completed: false, version: ONBOARDING_VERSION };
  }
}

// Serialize read-modify-write so rapid fire-and-forget patches (e.g. two quick
// Settings toggles) can't both read the same old state and clobber each other.
let onboardingWriteQueue = Promise.resolve();

function setOnboarding(patch) {
  const run = onboardingWriteQueue.then(async () => {
    const current = await getOnboarding();
    const next = { ...current, ...(patch || {}), version: ONBOARDING_VERSION };
    await fsp.mkdir(path.dirname(onboardingPath()), { recursive: true });
    await fsp.writeFile(onboardingPath(), JSON.stringify(next, null, 2));
    return next;
  });
  // Keep the queue chained even if this write rejects.
  onboardingWriteQueue = run.catch(() => {});
  return run;
}

function relaunchApp() {
  app.relaunch();
  app.exit(0);
}

function openExternal(url) {
  if (typeof url !== 'string' || !/^https?:\/\//i.test(url)) {
    throw new Error('Refusing to open non-http(s) URL.');
  }
  return shell.openExternal(url);
}

async function listFiles(dir) {
  const root = expandHome(dir);
  const rootStat = await fsp.stat(root);
  if (!rootStat.isDirectory()) throw new Error('not a directory');
  const skip = new Set([
    'node_modules',
    '.git',
    'dist',
    'build',
    'target',
    '.next',
    '.cache',
    'out',
  ]);
  const out = [];
  const stack = [root];
  while (stack.length && out.length < 6000) {
    const current = stack.pop();
    let entries = [];
    try {
      entries = await fsp.readdir(current, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        if (!entry.name.startsWith('.') && !skip.has(entry.name)) stack.push(fullPath);
      } else if (entry.isFile()) {
        out.push(path.relative(root, fullPath).split(path.sep).join('/'));
        if (out.length >= 6000) break;
      }
    }
  }
  return out.sort();
}

function readFile(filePath) {
  return fsp.readFile(expandHome(filePath), 'utf8');
}
