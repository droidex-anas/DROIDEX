const { app, BrowserWindow, Menu, clipboard, shell, webContents } = require('electron');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const githubVcs = require('./github.cjs');
const { appRoot } = require('./appPaths.cjs');
const { installRendererNavigationGuard } = require('./rendererSecurity.cjs');
const { installContextMenu } = require('./contextMenu.cjs');
const { createRendererOomRecovery, isRendererMemoryExit } = require('./rendererOomRecovery.cjs');
const { openExternal } = require('./externalLinks.cjs');

let mainWindow = null;

function getMainWindow() {
  return mainWindow;
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

function focusMainWindow() {
  // Never creates one: `openMainWindow` owns that, behind the preview session.
  if (!mainWindow || mainWindow.isDestroyed()) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
  if (process.platform === 'darwin' && app.dock) app.dock.bounce('informational');
}

function isWindowUsable(window) {
  return Boolean(window && !window.isDestroyed());
}

function createMainWindowController({
  appName: APP_NAME,
  devInstance,
  installWebviewAttachment,
  deliverPendingNotificationOpen,
  reloadFocusedBrowser,
  closeRendererOwnedTerminals,
  forgetBrowserWatchers,
  cleanupClosedWindow,
  attachPowerTier,
}) {
  const rendererOomRecovery = createRendererOomRecovery();
  function createMainWindow() {
    const devStartUrl = app.isPackaged ? undefined : process.env.ELECTRON_START_URL;
    const rendererFile = path.join(appRoot(), 'dist/index.html');
    const rendererEntryUrl = devStartUrl || pathToFileURL(rendererFile).toString();
    mainWindow = new BrowserWindow({
      width: 1440,
      height: 900,
      minWidth: 1000,
      minHeight: 600,
      title: devInstance?.title ?? APP_NAME,
      icon: path.join(
        __dirname,
        'assets',
        process.platform === 'darwin' ? 'icon.icns' : 'icon.png',
      ),
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
        // Browser pages and Canvas live previews are <webview> guests. Only this
        // window may create one, and only through the attachment routing
        // installed below, before any renderer content loads.
        webviewTag: true,
      },
    });
    if (devInstance) mainWindow.on('page-title-updated', (event) => event.preventDefault());
    installWebviewAttachment(mainWindow.webContents);
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
      cleanupClosedWindow();
      mainWindow = null;
    });
    attachPowerTier(mainWindow);
  }
  // With a browser page focused, Reload from the menu means that page;
  // reloading the shell would destroy every mounted page.
  function reloadFromMenu(ignoreCache) {
    if (!ignoreCache && reloadFocusedBrowser(webContents.getFocusedWebContents())) return;
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
      forgetBrowserWatchers();
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

  return { createMainWindow, reloadFromMenu };
}

module.exports = {
  createMainWindowController,
  getMainWindow,
  assertMainRenderer,
  focusMainWindow,
  isWindowUsable,
};
